import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ execute: vi.fn(), query: vi.fn(), getPool: vi.fn() }));
vi.mock("@/lib/tenant", () => ({ requireTenantFlota: vi.fn(), requireTenantFlotaAny: vi.fn(), sesionPuedeEditarVehiculosOtrasEmpresas: vi.fn() }));
vi.mock("@/lib/flota/schema", () => ({ asegurarSchemaFlota: vi.fn(async () => undefined), asegurarSchemaFlotaLectura: vi.fn(async () => undefined) }));
vi.mock("@/lib/flota/acceso", () => ({
  obtenerVehiculoAccesible: vi.fn(), listarVehiculosAccesibles: vi.fn(), empresasAccesoPorVehiculos: vi.fn(async () => new Map()),
  listarEmpresasActivasSimple: vi.fn(async () => []), guardarAccesoVehiculo: vi.fn(),
}));
vi.mock("@/lib/flota/filtros", () => ({ guardarFiltrosVehiculo: vi.fn(), listarFiltrosPorVehiculos: vi.fn(async () => new Map()) }));
vi.mock("@/lib/empresas", () => ({ obtenerEmpresaPorId: vi.fn() }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoria: vi.fn(), registrarAuditoriaTx: vi.fn() }));

import { getPool } from "@/lib/db";
import { requireTenantFlota, requireTenantFlotaAny, sesionPuedeEditarVehiculosOtrasEmpresas } from "@/lib/tenant";
import { guardarAccesoVehiculo, obtenerVehiculoAccesible } from "@/lib/flota/acceso";
import { obtenerEmpresaPorId } from "@/lib/empresas";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import { PATCH } from "../../app/api/empresas/[slug]/flota/vehiculos/route";

/**
 * La CONFIRMACIÓN explícita (`confirmarPlacaRepetida`) solo omite el aviso de «placa repetida al compartir»: no puede saltarse permisos
 * (solo la empresa dueña comparte), la comprobación previa de la placa ni ninguna otra validación. Ruta real con base simulada.
 * Escenario: #651 de Frescofresh (4) compartible con Mónaco (1), que ya tiene su propia #1300 con la misma placa.
 */
const DUENA = 4, MONACO = 1;
const ficha651 = { id: 651, empresa_id: DUENA, placa: "C-092BXF", marca: "Isuzu", modelo: "2023", descripcion: "", color: "", tipo_combustible: "Diesel", km_actual: 193735, km_intervalo_servicio: 5000, odometro_funcional: 1,
  mantenimiento_intervalo_meses: 3, en_taller: 0, fecha_entrada_taller: null, motivo_taller: null, estado: "Activo", activo: 1, notas: null, rin_llanta: null, medida_llanta: null, tipo_aceite: null, empresa_activo: null, compartido: 0 };
const guard = (empresaId: number, rol = "Admin") => ({ session: { id: 41, username: "admin", rol, accesoTodas: false }, empresa: { id: empresaId, nombre: empresaId === DUENA ? "Frescofresh" : "Mónaco", slug: "x", modulos: ["flota"] } }) as never;

let conn: ReturnType<typeof crearConexion>;
function crearConexion(opciones: { yaCompartida?: boolean; placaOtraFichaDuena?: string } = {}) {
  const sqls: string[] = [];
  const c = {
    beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(), destroy: vi.fn(),
    execute: vi.fn(async () => [{ affectedRows: 1 }]),
    query: vi.fn(async (sql: string, args: unknown[] = []) => {
      sqls.push(sql);
      if (sql.includes("FROM empresas WHERE id") && sql.includes("FOR UPDATE")) return [[{ id: DUENA }, { id: MONACO }]];
      if (sql.startsWith("SELECT * FROM flota_vehiculos WHERE id=? AND empresa_id=?")) return [[{ ...ficha651 }]];
      if (sql.includes("information_schema.TABLES")) return [[]]; // sin esquema de identidades: no pueden estar unidas
      if (sql.startsWith("SELECT id,empresa_id,placa FROM flota_vehiculos WHERE id=?")) return [[{ id: 651, empresa_id: DUENA, placa: "C-092BXF" }]];
      if (sql.startsWith("SELECT empresa_id FROM flota_vehiculo_acceso")) return [opciones.yaCompartida ? [{ empresa_id: MONACO }] : []];
      if (sql.startsWith("SELECT id,placa FROM flota_vehiculos WHERE empresa_id=?") && args[0] === MONACO) return [[{ id: 1300, placa: "C092BXF" }]];
      if (sql.startsWith("SELECT nombre FROM empresas")) return [[{ nombre: "Mónaco" }]];
      // coincidenciasPlacaTx (cambio de placa) y exigirSinDuplicadoCompartidoTx
      if (sql.startsWith("SELECT id,empresa_id,placa,chasis,tipo_unidad,activo FROM flota_vehiculos WHERE empresa_id=?")) return [opciones.placaOtraFichaDuena ? [{ id: 777, empresa_id: DUENA, placa: opciones.placaOtraFichaDuena, chasis: null, tipo_unidad: "VEHICULO", activo: 1 }] : []];
      if (sql.includes("JOIN flota_vehiculo_acceso a ON a.vehiculo_id=v.id")) return [[]];
      return [[]];
    }),
  };
  return Object.assign(c, { sqls });
}
const patch = (body: Record<string, unknown>) => PATCH(new Request("http://x/api", { method: "PATCH", body: JSON.stringify({ id: 651, ...body }) }), { params: Promise.resolve({ slug: "x" }) });
function escenario(o: { empresaActiva: number; permisoTransversal?: boolean; conexion?: Parameters<typeof crearConexion>[0] }) {
  conn = crearConexion(o.conexion);
  vi.mocked(requireTenantFlota).mockResolvedValue(guard(o.empresaActiva));
  vi.mocked(requireTenantFlotaAny).mockResolvedValue(guard(o.empresaActiva));
  vi.mocked(sesionPuedeEditarVehiculosOtrasEmpresas).mockResolvedValue(o.permisoTransversal ?? false);
  vi.mocked(obtenerVehiculoAccesible).mockResolvedValue({ ...ficha651, compartido: o.empresaActiva === DUENA ? 0 : 1 } as never);
  vi.mocked(obtenerEmpresaPorId).mockResolvedValue({ id: DUENA, nombre: "Frescofresh" } as never);
  vi.mocked(getPool).mockReturnValue({ getConnection: async () => conn } as never);
}
beforeEach(() => vi.resetAllMocks());

describe("PATCH compartir: la confirmación explícita no omite permisos ni otras validaciones", () => {
  it("sin confirmación: 409 con código, sin compartir y con la transacción revertida", async () => {
    escenario({ empresaActiva: DUENA });
    const r = await patch({ accesoEmpresaIds: [MONACO] });
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ codigo: "PLACA_REPETIDA_AL_COMPARTIR" });
    expect(guardarAccesoVehiculo).not.toHaveBeenCalled();
    expect(conn.rollback).toHaveBeenCalled(); expect(conn.commit).not.toHaveBeenCalled();
  });
  it("con confirmación (empresa dueña): comparte UNA vez, audita la decisión y confirma la transacción", async () => {
    escenario({ empresaActiva: DUENA });
    const r = await patch({ accesoEmpresaIds: [MONACO], confirmarPlacaRepetida: true });
    expect(r.status).toBe(200);
    expect(guardarAccesoVehiculo).toHaveBeenCalledTimes(1);
    expect(vi.mocked(guardarAccesoVehiculo).mock.calls[0].slice(0, 3)).toEqual([651, [MONACO], DUENA]);
    const auditorias = vi.mocked(registrarAuditoriaTx).mock.calls.map(c => c[1] as { accion: string; detalle: string });
    expect(auditorias.filter(a => a.accion === "compartir_con_placa_repetida")).toHaveLength(1);
    expect(JSON.parse(auditorias.find(a => a.accion === "compartir_con_placa_repetida")!.detalle)).toEqual({ vehiculoId: 651, empresas: [MONACO], confirmado: true });
    expect(conn.commit).toHaveBeenCalled();
  });
  it("las empresas destino se bloquean junto con la dueña, en una sola sentencia ordenada por id (sin interbloqueos)", async () => {
    escenario({ empresaActiva: DUENA });
    await patch({ accesoEmpresaIds: [MONACO], confirmarPlacaRepetida: true });
    const bloqueo = conn.sqls.find(s => s.includes("FROM empresas WHERE id IN (?)"))!;
    expect(bloqueo).toContain("ORDER BY id FOR UPDATE");
    const args = conn.query.mock.calls.find(c => String(c[0]).includes("FROM empresas WHERE id IN (?)"))![1] as number[][];
    expect(args[0]).toEqual([MONACO, DUENA]); // ascendente: 1, 4
  });
  it("una empresa que NO es la dueña no comparte aunque tenga permiso transversal y confirme: 403 sin abrir transacción", async () => {
    escenario({ empresaActiva: MONACO, permisoTransversal: true });
    const r = await patch({ accesoEmpresaIds: [MONACO], confirmarPlacaRepetida: true });
    expect(r.status).toBe(403);
    expect(getPool).not.toHaveBeenCalled();
    expect(guardarAccesoVehiculo).not.toHaveBeenCalled();
  });
  it("sin permiso transversal tampoco (403) y la confirmación no cambia nada", async () => {
    escenario({ empresaActiva: MONACO, permisoTransversal: false });
    const r = await patch({ accesoEmpresaIds: [MONACO], confirmarPlacaRepetida: true });
    expect(r.status).toBe(403);
    expect(getPool).not.toHaveBeenCalled();
    expect(guardarAccesoVehiculo).not.toHaveBeenCalled();
  });
  it("confirmar NO omite la validación de la placa: un cambio de placa que ya existe en la dueña se rechaza (409) y no se comparte", async () => {
    escenario({ empresaActiva: DUENA, conexion: { placaOtraFichaDuena: "C-999ZZZ" } });
    const r = await patch({ placa: "C 999 ZZZ", accesoEmpresaIds: [MONACO], confirmarPlacaRepetida: true });
    expect(r.status).toBe(409);
    expect(guardarAccesoVehiculo).not.toHaveBeenCalled();
    expect(conn.rollback).toHaveBeenCalled();
  });
  it("confirmar sin pedir compartir no hace nada especial; una compartición que ya existía no se vuelve a avisar", async () => {
    escenario({ empresaActiva: DUENA });
    expect((await patch({ marca: "Isuzu", confirmarPlacaRepetida: true })).status).toBe(200);
    expect(guardarAccesoVehiculo).not.toHaveBeenCalled();
    expect(vi.mocked(registrarAuditoriaTx).mock.calls.some(c => (c[1] as { accion: string }).accion === "compartir_con_placa_repetida")).toBe(false);
    vi.resetAllMocks(); escenario({ empresaActiva: DUENA, conexion: { yaCompartida: true } });
    expect((await patch({ accesoEmpresaIds: [MONACO] })).status).toBe(200); // sin confirmación y sin aviso: ya estaba compartida
    expect(vi.mocked(registrarAuditoriaTx).mock.calls.some(c => (c[1] as { accion: string }).accion === "compartir_con_placa_repetida")).toBe(false);
  });
  it("un valor no booleano en confirmarPlacaRepetida se rechaza (400) y nunca equivale a confirmar", async () => {
    escenario({ empresaActiva: DUENA });
    for (const raro of ["true", 1, "si", {}]) expect((await patch({ accesoEmpresaIds: [MONACO], confirmarPlacaRepetida: raro })).status).toBe(400);
    expect(guardarAccesoVehiculo).not.toHaveBeenCalled();
  });
});
