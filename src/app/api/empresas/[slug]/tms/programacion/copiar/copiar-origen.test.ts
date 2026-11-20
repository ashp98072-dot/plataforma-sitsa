import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tenant", () => ({ requireTenantProgramacion: vi.fn(), requireTenantProgramacionOTms: vi.fn() }));
vi.mock("@/lib/db", () => ({ query: vi.fn(), getPool: vi.fn(() => ({})) }));
// El plazo de la operación se prueba aparte (db-plazo.test.ts, copiar-routes.test.ts y la prueba con MariaDB): aquí el cuerpo corre tal cual.
vi.mock("@/lib/db-plazo", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/db-plazo")>()), conPlazo: async (_pool: unknown, _opts: unknown, fn: () => Promise<unknown>) => fn() }));
vi.mock("@/lib/tms/paradas", () => ({ listarParadasDePlanes: vi.fn(async (ids: number[]) => new Map(ids.map((i) => [i, []]))) }));
vi.mock("@/lib/tms/programacion-lote", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tms/programacion-lote")>()),
  validarLote: vi.fn(),
  confirmarLote: vi.fn(),
}));

import { query } from "@/lib/db";
import { requireTenantProgramacion, requireTenantProgramacionOTms } from "@/lib/tenant";
import { confirmarLote, validarLote } from "@/lib/tms/programacion-lote";
import { GET as cargar } from "./route";
import { POST as validar } from "./validar/route";
import { POST as confirmar } from "./confirmar/route";
import { cuerpoLote, filaDesdeCarga, seleccionarTodos } from "@/app/e/[slug]/programacion/copiar/copiar-helpers";

/**
 * COPIA FIEL (decisión del propietario): el ORIGEN puede estar en CUALQUIER estado (Programado, En curso, Cerrado o Cancelado). El backend
 * (cargar, validar y confirmar, con la función REAL `borradoresDesdeCliente`) valida SOLO empresa + fecha origen + existencia: un origen de otra
 * empresa/fecha sigue rechazándose aunque lo mande un cliente a mano. El estado del origen nunca se copia (los nuevos nacen Programados).
 * (Distinto de la regla del plan DESTINO cancelado, que sí permite volver a copiar: vive en el motor.)
 */
const ctx = { params: Promise.resolve({ slug: "acme" }) };
const ORIGEN = "2026-09-24";
const planes = [
  { id: 900, empresa_id: 7, fecha: ORIGEN, estado: "Programado" },
  { id: 901, empresa_id: 7, fecha: ORIGEN, estado: "Cerrado" },
  { id: 902, empresa_id: 7, fecha: ORIGEN, estado: "Cancelado" },
  { id: 905, empresa_id: 7, fecha: ORIGEN, estado: "En curso" },
  { id: 903, empresa_id: 7, fecha: "2026-09-20", estado: "Programado" }, // otra fecha
  { id: 904, empresa_id: 8, fecha: ORIGEN, estado: "Programado" }, // otra empresa
];
const fila = (origenPlanId: number, n = 1) => ({ fila: n, origenPlanId, rutaId: 10, clienteId: 3, horaCarga: "03:00", tipoTraslado: null, tipoViaje: "Propio", unidadPlaca: null, tcVehiculoId: null, pilotoEmpleadoId: null, auxiliarEmpleadoIds: [], tarifaId: null, externo: null });
const cuerpo = (ids: number[]) => ({ fechaOrigen: ORIGEN, fechaDestino: "2026-09-25", filas: ids.map((id, i) => fila(id, i + 1)), tarifasEsperadas: ids.map((_, i) => ({ fila: i + 1, tarifa: null })) });
const post = (fn: typeof validar, body: unknown) => fn(new Request("http://x/api", { method: "POST", body: JSON.stringify(body) }), ctx);
const MENSAJE = "Algún viaje origen no existe o no pertenece a la fecha/empresa indicada.";

beforeEach(() => {
  vi.resetAllMocks();
  const sesion = { session: { username: "jefe" }, empresa: { id: 7 } };
  vi.mocked(requireTenantProgramacion).mockResolvedValue(sesion as never);
  vi.mocked(requireTenantProgramacionOTms).mockResolvedValue(sesion as never);
  vi.mocked(validarLote).mockResolvedValue([]);
  vi.mocked(confirmarLote).mockResolvedValue({ ok: true, planIds: [1000], codigos: ["PLAN-1"] });
  // Emula el SELECT de la base HONRANDO los predicados presentes en el SQL: si alguien volviera a añadir `estado <> 'Cancelado'` a
  // alguna consulta de origen, el Cancelado dejaría de cargarse/validarse y estas pruebas fallarían.
  vi.mocked(query).mockImplementation((async (sql: string, params: unknown[]) => {
    const s = String(sql);
    if (s.includes("SELECT id, vehiculo_solicitado_perfil_id")) {
      const [emp, ...ids] = params;
      return planes.filter((p) => p.empresa_id === emp && ids.includes(p.id)).map((p) => ({
        id: p.id, vehiculo_solicitado_perfil_id: p.id === 900 ? 11 : null,
      }));
    }
    if (s.includes("FROM tms_planes_viaje") && s.includes("p.fecha_plan = ?")) {
      const [emp, fecha] = params as [number, string];
      return planes.filter((p) => p.empresa_id === emp && p.fecha === fecha && (!s.includes("estado <> 'Cancelado'") || p.estado !== "Cancelado")).map((p) => ({ id: p.id, codigo: `P${p.id}`, estado: p.estado }));
    }
    if (s.includes("FROM tms_planes_viaje WHERE empresa_id = ? AND fecha_plan = ?") && s.includes("DATE_FORMAT(regreso_estimado")) {
      const [emp, fecha, ...ids] = params as [number, string, ...number[]];
      return planes.filter((p) => p.empresa_id === emp && p.fecha === fecha && (!s.includes("estado <> 'Cancelado'") || p.estado !== "Cancelado") && ids.includes(p.id)).map((p) => ({ id: p.id, hora_carga: null, regreso_estimado: null }));
    }
    return [];
  }) as never);
});

describe("GET: la carga inicial devuelve TODOS los viajes de la fecha, de cualquier estado", () => {
  it("incluye Programado, Cerrado, En curso y CANCELADO; el SQL no filtra por estado", async () => {
    const r = await cargar(new Request(`http://x/api?fechaOrigen=${ORIGEN}&fechaDestino=2026-09-25`), ctx);
    expect(r.status).toBe(200);
    const sql = String(vi.mocked(query).mock.calls[0][0]);
    expect(sql).not.toMatch(/p\.estado\s*(<>|!=|IN|NOT IN)/i);
    expect(sql).not.toContain("Cancelado");
    const data = await r.json();
    expect(data.filas.map((f: { origen: { planId: number; estado: string } }) => [f.origen.planId, f.origen.estado])).toEqual([[900, "Programado"], [901, "Cerrado"], [902, "Cancelado"], [905, "En curso"]]);
  });
  it("solo de ESTA empresa y fecha: no aparecen los de otra empresa ni otra fecha", async () => {
    const data = await (await cargar(new Request(`http://x/api?fechaOrigen=${ORIGEN}&fechaDestino=2026-09-25`), ctx)).json();
    expect(data.filas.map((f: { origen: { planId: number } }) => f.origen.planId)).not.toContain(903);
    expect(data.filas.map((f: { origen: { planId: number } }) => f.origen.planId)).not.toContain(904);
    expect(String(vi.mocked(query).mock.calls[0][0])).toMatch(/p\.empresa_id = \? AND p\.fecha_plan = \?/);
  });
});

describe("POST /validar con orígenes enviados a mano", () => {
  it.each([validar, confirmar])("carga -> payload UI -> POST conserva el perfil del servidor y admite orígenes antiguos", async (handler) => {
    const carga = await cargar(new Request(`http://x/api?fechaOrigen=${ORIGEN}&fechaDestino=2026-09-25`), ctx);
    const data = await carga.json();
    expect(data.filas.map((f: { borrador: { vehiculoSolicitadoPerfilId: number | null } }) => f.borrador.vehiculoSolicitadoPerfilId)).toEqual([11, null, null, null]);
    const payload = cuerpoLote(ORIGEN, "2026-09-25", seleccionarTodos(data.filas.map(filaDesdeCarga)));
    for (const f of payload.filas) expect(f).not.toHaveProperty("vehiculoSolicitadoPerfilId");
    vi.mocked(validarLote).mockClear();
    expect((await post(handler, handler === confirmar ? { ...payload, tarifasEsperadas: payload.filas.map((f) => ({ fila: f.fila, tarifa: null })) } : payload)).status).toBe(200);
    const borradores = handler === validar
      ? vi.mocked(validarLote).mock.calls[0][2]
      : vi.mocked(confirmarLote).mock.calls[0][4];
    expect(borradores.map((b) => b.vehiculoSolicitadoPerfilId)).toEqual([11, null, null, null]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("SELECT id, vehiculo_solicitado_perfil_id"), [7, 900, 901, 902, 905]);
  });

  it.each([validar, confirmar])("rechaza un perfil inyectado por el cliente", async (handler) => {
    const payload = cuerpo([900]);
    expect((await post(handler, { ...payload, filas: [{ ...payload.filas[0], vehiculoSolicitadoPerfilId: 99 }] })).status).toBe(400);
    expect(validarLote).not.toHaveBeenCalled();
    expect(confirmarLote).not.toHaveBeenCalled();
  });
  it("origen CANCELADO o EN CURSO: se acepta y llega al motor (el estado del origen no se copia)", async () => {
    expect((await post(validar, cuerpo([902]))).status).toBe(200);
    expect((await post(validar, cuerpo([905]))).status).toBe(200);
    expect(vi.mocked(validarLote).mock.calls.map((c) => c[2].map((b) => b.origenPlanId))).toEqual([[902], [905]]);
    for (const [, , borradores] of vi.mocked(validarLote).mock.calls) for (const b of borradores) expect(b).not.toHaveProperty("estado");
  });
  it("un lote con válidos y un Cancelado se valida completo (mismo comportamiento que cualquier estado)", async () => {
    expect((await post(validar, cuerpo([900, 902, 905]))).status).toBe(200);
    expect(vi.mocked(validarLote).mock.calls[0][2].map((b) => b.origenPlanId)).toEqual([900, 902, 905]);
  });
  it("la consulta de validación del origen NO filtra por estado y SIGUE filtrando por empresa y fecha", async () => {
    await post(validar, cuerpo([902]));
    const sql = String(vi.mocked(query).mock.calls.map((c) => String(c[0])).find((q) => q.includes("DATE_FORMAT(regreso_estimado"))!);
    expect(sql).not.toMatch(/estado/i);
    expect(sql).toMatch(/WHERE empresa_id = \? AND fecha_plan = \? AND id IN/);
  });
  it("origen CERRADO sigue permitido", async () => {
    expect((await post(validar, cuerpo([901]))).status).toBe(200);
    expect((await post(validar, cuerpo([900, 901]))).status).toBe(200);
    expect(validarLote).toHaveBeenCalledTimes(2);
  });
  it("origen de OTRA FECHA -> 400; origen de OTRA EMPRESA -> 400", async () => {
    const fecha = await post(validar, cuerpo([903]));
    expect(fecha.status).toBe(400);
    expect(await fecha.json()).toEqual({ error: MENSAJE });   // el mensaje ya no menciona «cancelado»: el estado no es criterio
    expect((await post(validar, cuerpo([904]))).status).toBe(400);
    expect(validarLote).not.toHaveBeenCalled();
  });
});

describe("POST /confirmar con orígenes enviados a mano", () => {
  it("origen CANCELADO: llega al motor de lote (se creará un viaje PROGRAMADO nuevo; el origen no cambia)", async () => {
    const r = await post(confirmar, cuerpo([902]));
    expect(r.status).toBe(200);
    expect(confirmarLote).toHaveBeenCalledTimes(1);
    expect(vi.mocked(confirmarLote).mock.calls[0][4].map((b) => b.origenPlanId)).toEqual([902]);
  });
  it("un lote con válidos, En curso y Cancelado se confirma completo en una sola llamada al motor (atómica)", async () => {
    expect((await post(confirmar, cuerpo([900, 902, 905]))).status).toBe(200);
    expect(confirmarLote).toHaveBeenCalledTimes(1);
    expect(vi.mocked(confirmarLote).mock.calls[0][4].map((b) => b.origenPlanId)).toEqual([900, 902, 905]);
  });
  it("origen CERRADO sigue permitido y llega al motor de lote", async () => {
    const r = await post(confirmar, cuerpo([901]));
    expect(r.status).toBe(200);
    expect(confirmarLote).toHaveBeenCalledTimes(1);
    expect(vi.mocked(confirmarLote).mock.calls[0][4].map((b) => b.origenPlanId)).toEqual([901]);
  });
  it("origen de OTRA FECHA o de OTRA EMPRESA -> 400 y no se crea nada", async () => {
    expect((await post(confirmar, cuerpo([903]))).status).toBe(400);
    expect((await post(confirmar, cuerpo([904]))).status).toBe(400);
    expect(confirmarLote).not.toHaveBeenCalled();
  });
  it("la empresa de la sesión manda: con otra empresa en sesión el plan 900 (empresa 7) no es origen válido", async () => {
    vi.mocked(requireTenantProgramacion).mockResolvedValue({ session: { username: "otro" }, empresa: { id: 8 } } as never);
    expect((await post(confirmar, cuerpo([900]))).status).toBe(400);
    expect(confirmarLote).not.toHaveBeenCalled();
  });
});

describe("ORIGEN cancelado ≠ DESTINO anterior cancelado", () => {
  it("el origen no se filtra por estado en NINGUNA consulta de programacion-copia.ts", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/lib/tms/programacion-copia.ts", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(src).not.toMatch(/estado\s*<>\s*'Cancelado'/);
    expect(src).not.toContain("está cancelado");
  });
  it("la regla del destino vive en el motor: el anti-duplicado sigue ignorando planes DESTINO Cancelados (se puede volver a copiar si la copia se canceló)", async () => {
    const { readFileSync } = await import("node:fs");
    const motor = readFileSync("src/lib/tms/programacion-lote.ts", "utf8");
    expect(motor).toContain("p.estado <> 'Cancelado'");
    expect(motor).toContain("Este viaje ya fue copiado para esta fecha");
  });
});
