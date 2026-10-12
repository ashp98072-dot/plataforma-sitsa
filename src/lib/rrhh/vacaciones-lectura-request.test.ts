import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/db", async () => {
  const { bd } = await import("./vacaciones-registro-bd.testutil");
  return { query: (sql: string, p?: unknown[]) => bd.consulta(sql, p),
    getPool: () => ({ getConnection: async () => bd.conexion() }) };
});
vi.mock("@/lib/tenant", () => ({ requireTenantRrhh: vi.fn(async () => ({ empresa: { id: 7 } })) }));
vi.mock("@/lib/rrhh/colaborador-session", () => ({ getColaboradorSession: vi.fn(async () => ({ empresaId: 7, empleadoId: 1 })) }));
vi.mock("@/lib/rrhh/solicitudes-vacaciones", () => ({ listarSolicitudesPorEmpleado: vi.fn(async () => []), crearSolicitudVacaciones: vi.fn() }));
import { bd, escenario } from "./vacaciones-registro-bd.testutil";
import { calcularSaldoTotalDisponible, crearLecturaVacacionesEmpleado, obtenerHistorialPeriodos,
  obtenerPeriodosDisponibles, registrarVacacionesFifo } from "./vacaciones";
import { GET } from "@/app/api/empresas/[slug]/rrhh/vacaciones/route";
import { GET as PORTAL } from "@/app/api/portal/vacaciones/route";

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 7, 12)); bd.reiniciar(escenario()); });
afterEach(() => vi.useRealTimers());
async function antes() {
  return { saldo: await calcularSaldoTotalDisponible(7, 1), periodos: await obtenerPeriodosDisponibles(7, 1),
    historial: await obtenerHistorialPeriodos(7, 1) };
}
async function despues() {
  const r = crearLecturaVacacionesEmpleado(7, 1);
  const [saldo, periodos, historial] = await Promise.all([
    r.calcularSaldoTotalDisponible(), r.obtenerPeriodosDisponibles(), r.obtenerHistorialPeriodos(),
  ]);
  return { saldo, periodos, historial };
}
describe("lectura de vacaciones por request contra motor real y BD en memoria", () => {
  it.each(["multiples", "inexistente", "sin alta", "FIFO", "historico"])("mismo DTO/estado que helpers anteriores: %s", async (caso) => {
    if (caso === "inexistente") bd.reiniciar({});
    if (caso === "sin alta") bd.reiniciar(escenario({ fechaAlta: null }));
    if (caso === "FIFO" || caso === "historico") {
      await registrarVacacionesFifo({ empresaId: 7, idEmpleado: 1, fechaInicio: "2026-09-01", fechaFin: "2026-09-02", diasATomar: 2 });
    }
    if (caso === "historico") bd.t.configuracion.push({ empresa_id: 7, parametro: "vacaciones_modo_carga_historica", valor: "1" });
    const inicial = structuredClone(bd.t);
    bd.reiniciar(structuredClone(inicial));
    const esperado = await antes();
    const estadoEsperado = structuredClone(bd.t);
    expect(bd.eventos.filter(e => e === "BEGIN")).toHaveLength(3);
    bd.reiniciar(structuredClone(inicial));
    expect(await despues()).toEqual(esperado);
    expect(bd.t).toEqual(estadoEsperado);
    expect(bd.eventos.filter(e => e === "BEGIN")).toHaveLength(1);
    expect(bd.eventos.filter(e => e === "COMMIT")).toHaveLength(1);
  });
  it("GET resumen staff sincroniza una vez y conserva respuesta", async () => {
    const inicial = structuredClone(bd.t);
    const esperado = await antes();
    bd.reiniciar(inicial);
    const res = await GET(new Request("http://x?soloResumen=1&empleadoId=1"), { params: Promise.resolve({ slug: "sitsa" }) });
    expect(await res.json()).toEqual(esperado);
    expect(bd.eventos.filter(e => e === "BEGIN")).toHaveLength(1);
  });
  it("lectores independientes no comparten sync ni empresa ni estado entre requests", async () => {
    const ajeno = crearLecturaVacacionesEmpleado(8, 1);
    expect(await ajeno.calcularSaldoTotalDisponible()).toBe(0);
    const propio = crearLecturaVacacionesEmpleado(7, 1);
    expect(await propio.calcularSaldoTotalDisponible()).toBeGreaterThan(0);
    expect(await ajeno.obtenerPeriodosDisponibles()).toEqual([]);
    await crearLecturaVacacionesEmpleado(7, 1).calcularSaldoTotalDisponible();
    expect(bd.eventos.filter(e => e === "BEGIN")).toHaveLength(3);
    expect(bd.t.saldos.every(s => s.empresa_id === 7)).toBe(true);
  });
  it("GET portal comparte una sincronizacion entre saldo y periodos y conserva DTO", async () => {
    const inicial = structuredClone(bd.t);
    const esperado = await antes();
    bd.reiniciar(inicial);
    expect(await (await PORTAL()).json()).toEqual({saldo: esperado.saldo, periodos: esperado.periodos, solicitudes: []});
    expect(bd.eventos.filter(e => e === "BEGIN")).toHaveLength(1);
  });
  it("no reintenta sync fallida dentro del request; el siguiente tiene su propia transaccion", async () => {
    bd.fallarSi = sql => sql.includes("SELECT fecha_alta");
    const r = crearLecturaVacacionesEmpleado(7, 1);
    await expect(r.calcularSaldoTotalDisponible()).rejects.toThrow("fallo inyectado");
    await expect(r.obtenerHistorialPeriodos()).rejects.toThrow("fallo inyectado");
    expect(bd.eventos.filter(e => e === "BEGIN")).toHaveLength(1);
    bd.fallarSi = null;
    expect(await crearLecturaVacacionesEmpleado(7, 1).calcularSaldoTotalDisponible()).toBeGreaterThan(0);
  });
});
