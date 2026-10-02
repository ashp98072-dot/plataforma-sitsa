import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * PROGRAMACION-PARADAS-FUENTE — las PARADAS son la fuente de captura: el servidor deriva, en la misma transacción,
 * lugar_carga_id, lugar_descarga_id y el snapshot lugar_descarga_historico ("Lugar de Descarga" del reporte). Se ejercita el
 * handler REAL (POST/PATCH); solo se sustituye la E/S (mismo arnés que persistencia-edicion.test.ts).
 */
vi.mock("@/lib/db", () => ({ execute: vi.fn(), getPool: vi.fn(), query: vi.fn() }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoria: vi.fn(), registrarAuditoriaTx: vi.fn() }));
vi.mock("@/lib/tenant", () => ({ requireTenantProgramacion: vi.fn(), requireTenantProgramacionOTms: vi.fn() }));
vi.mock("@/lib/flota/schema", () => ({ asegurarSchemaFlota: vi.fn(() => Promise.resolve()) }));
vi.mock("@/lib/operaciones/disponibilidad", () => ({
  listarDisponibilidadVehiculos: vi.fn(() => Promise.resolve({ vehiculos: [], resumen: {} })),
  placasDisponiblesParaPlan: vi.fn(() => []),
}));
vi.mock("@/lib/operaciones/disponibilidad-personal", () => ({ listarDisponibilidadPersonal: vi.fn(() => Promise.resolve([])) }));
vi.mock("@/lib/tms/codigo-plan", () => ({ asegurarCodigoPlanUnico: vi.fn(() => Promise.resolve("PLAN-1")), generarCodigoPlan: vi.fn() }));
vi.mock("@/lib/tms/paradas", () => ({
  guardarParadasPlan: vi.fn(() => Promise.resolve({ ok: true })),
  listarParadasDePlanes: vi.fn(() => Promise.resolve(new Map())),
}));
vi.mock("@/lib/flota/acceso", () => ({ obtenerVehiculoAccesible: vi.fn() }));
vi.mock("@/lib/flota/pilotos", () => ({ vehiculoPorPlaca: vi.fn() }));
vi.mock("@/lib/tms/viaticos", () => ({
  listarViaticosRechazadosDelPlan: vi.fn(() => Promise.resolve([])),
  personalRecienAsignadoDelPlan: vi.fn(() => Promise.resolve([])),
  sincronizarViaticosPlan: vi.fn(() => Promise.resolve()),
}));
vi.mock("@/lib/tms/plan-comunes", () => ({
  upsertLugar: vi.fn(),
  guardarAuxiliaresPlan: vi.fn(() => Promise.resolve()),
}));
vi.mock("@/lib/tms/personal-resolucion", () => ({ personalDesdeEmpleado: vi.fn(() => Promise.resolve(null)), validarPersonalId: vi.fn() }));

import { execute, getPool, query } from "@/lib/db";
import { requireTenantProgramacion } from "@/lib/tenant";
import { guardarParadasPlan } from "@/lib/tms/paradas";
import { upsertLugar } from "@/lib/tms/plan-comunes";
import { PATCH, POST } from "./route";

const ctx = { params: Promise.resolve({ slug: "kt" }) };
const post = (body: unknown) => POST(new Request("http://x/api", { method: "POST", body: JSON.stringify(body) }), ctx);
const patch = (body: unknown) => PATCH(new Request("http://x/api", { method: "PATCH", body: JSON.stringify(body) }), ctx);
const FECHA = "2026-12-15";
const IDS_LUGAR: Record<string, number> = { "BODEGAS CALSA, ZONA 12": 11, "CD WALMART, VILLA NUEVA": 21, "CD WALMART, VILLA NUEVA 2": 22, "BODEGA NUEVA": 12, "DESCARGA B2": 23 };

let plan: Record<string, unknown>;
let historicoActual: string | null;
let paradasActuales: { lugar_nombre: string; tipo: string }[];

function crearConexion() {
  return {
    beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(),
    query: vi.fn(async (sql: string) => {
      const s = String(sql);
      if (s.includes("GET_LOCK")) return [[{ l: 1 }]];
      if (s.includes("SELECT lugar_descarga_historico FROM tms_planes_viaje")) return [[{ lugar_descarga_historico: historicoActual }]];
      if (s.includes("FROM tms_plan_paradas WHERE plan_id")) return [paradasActuales];
      return [[]];
    }),
    execute: vi.fn<(sql: string, params?: unknown[]) => Promise<unknown[]>>(async () => [{ insertId: 55, affectedRows: 1 }]),
  };
}
let conexion: ReturnType<typeof crearConexion>;

/** Valor que el INSERT envía para `columna` (posición dentro de la lista de columnas). */
function valorInsert(columna: string): unknown {
  const call = conexion.execute.mock.calls.find((c) => String(c[0]).includes("INSERT INTO tms_planes_viaje"))!;
  const sql = String(call[0]);
  const cols = sql.slice(sql.indexOf("(") + 1, sql.indexOf(")")).split(",").map((c) => c.trim());
  return (call[1] as unknown[])[cols.indexOf(columna)];
}
const updatePrincipal = () => conexion.execute.mock.calls.find((c) => String(c[0]).includes("UPDATE tms_planes_viaje SET\n")) as unknown as [string, unknown[]];
/** Lo que el UPDATE principal hace con lugar_descarga_historico: { toca, valor } (forma `CASE WHEN ? THEN ? ELSE col END`). */
function historicoPatch(): { toca: boolean; valor: unknown } {
  const [sql, params] = updatePrincipal();
  const linea = sql.split("\n").find((l) => l.trim().startsWith("lugar_descarga_historico ="))!;
  expect(linea).toMatch(/CASE WHEN \? THEN \? ELSE lugar_descarga_historico END/);
  const antes = (sql.slice(0, sql.indexOf(linea)).match(/\?/g) ?? []).length;
  return { toca: Boolean(params[antes]), valor: params[antes + 1] };
}
const lugaresUpdate = () => conexion.execute.mock.calls.find((c) => String(c[0]).includes("lugar_carga_id = ?")) as unknown as [string, unknown[]] | undefined;

const P_CARGA = { lugarNombre: "BODEGAS CALSA, ZONA 12", tipo: "Carga", requiereEvidencia: true };
const P_DESC = { lugarNombre: "CD WALMART, VILLA NUEVA", tipo: "Descarga", requiereEvidencia: true };

beforeEach(() => {
  vi.resetAllMocks();
  conexion = crearConexion();
  historicoActual = null;
  paradasActuales = [];
  plan = {
    id: 5, codigo: "PLAN-5", estado: "Programado", fecha_plan: FECHA, hora_carga: "04:00:00", notas: null, piloto_id: null, unidad_id: null,
    regreso_estimado: null, ruta_id: 8, tipo_viaje: "Propio", tc_vehiculo_id: null, cliente_id: 3, cliente_nombre: "ACME",
    tarifa_comercial: 1250, tarifa_id: null, costo_operativo_referencia: null, referencia_cliente: null, placa: null, flota_vehiculo_id: null,
    piloto: null, pendiente_cierre: 0,
  };
  vi.mocked(requireTenantProgramacion).mockResolvedValue({ error: null, empresa: { id: 7, nombre: "KT" }, session: { username: "ops", id: 3 } } as never);
  vi.mocked(getPool).mockReturnValue({ getConnection: vi.fn().mockResolvedValue(conexion) } as never);
  vi.mocked(execute).mockResolvedValue({ insertId: 91, affectedRows: 1 } as never);
  vi.mocked(query).mockImplementation((async (sql: string) => (String(sql).includes("FROM tms_planes_viaje p") && String(sql).includes("LIMIT 1") ? [plan] : [])) as never);
  vi.mocked(guardarParadasPlan).mockResolvedValue({ ok: true } as never);
  vi.mocked(upsertLugar).mockImplementation((async (_e: number, nombre: string | undefined) => (nombre?.trim() ? (IDS_LUGAR[nombre.trim()] ?? 99) : null)) as never);
});

describe("POST — las paradas definen carga, descarga y el snapshot del reporte", () => {
  it("1-4) Carga + Descarga: lugar_carga_id, lugar_descarga_id y lugar_descarga_historico salen de las paradas (sin capturar nada más)", async () => {
    const res = await post({ fechaPlan: FECHA, horaCarga: "08:00", paradas: [P_CARGA, P_DESC] });
    expect(res.status).toBe(200);
    expect(valorInsert("lugar_carga_id")).toBe(11);
    expect(valorInsert("lugar_descarga_id")).toBe(21);
    expect(valorInsert("lugar_descarga_historico")).toBe("CD WALMART, VILLA NUEVA");
    expect(guardarParadasPlan).toHaveBeenCalledWith(7, expect.anything(), [expect.objectContaining(P_CARGA), expect.objectContaining(P_DESC)], conexion);
  });
  it("5-6) varias descargas: se conservan TODAS las paradas y solo la PRIMERA alimenta el snapshot y lugar_descarga_id", async () => {
    const paradas = [P_CARGA, P_DESC, { lugarNombre: "CD WALMART, VILLA NUEVA 2", tipo: "Descarga" }, { lugarNombre: "DESCARGA B2", tipo: "Entrega" }];
    expect((await post({ fechaPlan: FECHA, horaCarga: "08:00", paradas })).status).toBe(200);
    expect(valorInsert("lugar_descarga_historico")).toBe("CD WALMART, VILLA NUEVA"); // sin concatenar
    expect(valorInsert("lugar_descarga_id")).toBe(21);
    expect(vi.mocked(guardarParadasPlan).mock.calls[0][2]).toHaveLength(4);
  });
  it("una Entrega cuenta como descarga cuando es la primera", async () => {
    const paradas = [P_CARGA, { lugarNombre: "DESCARGA B2", tipo: "Entrega" }];
    expect((await post({ fechaPlan: FECHA, horaCarga: "08:00", paradas })).status).toBe(200);
    expect(valorInsert("lugar_descarga_historico")).toBe("DESCARGA B2");
    expect(valorInsert("lugar_descarga_id")).toBe(23);
  });
  it("11) ruta maestra: una descripción operativa DISTINTA enviada explícitamente se conserva (VIAT-4b); sin ella se deriva", async () => {
    const descripcion = "RUTA-A - Calsa-Walmart-Villa Nueva";
    expect((await post({ fechaPlan: FECHA, horaCarga: "08:00", paradas: [P_CARGA, P_DESC], lugarDescargaHistorico: descripcion })).status).toBe(200);
    expect(valorInsert("lugar_descarga_historico")).toBe(descripcion);
    expect(valorInsert("lugar_descarga_id")).toBe(21); // el id sigue saliendo de la parada
  });
  it("compatibilidad: el payload clásico lugarCarga/lugarDescarga (sin paradas) sigue alimentando todo", async () => {
    expect((await post({ fechaPlan: FECHA, horaCarga: "08:00", lugarCarga: "BODEGAS CALSA, ZONA 12", lugarDescarga: "CD WALMART, VILLA NUEVA" })).status).toBe(200);
    expect(valorInsert("lugar_descarga_historico")).toBe("CD WALMART, VILLA NUEVA");
    expect(valorInsert("lugar_carga_id")).toBe(11);
  });
  it("sin paradas ni descarga: el snapshot queda NULL (no se inventa)", async () => {
    expect((await post({ fechaPlan: FECHA, horaCarga: "08:00" })).status).toBe(200);
    expect(valorInsert("lugar_descarga_historico")).toBeNull();
  });
  it("16) misma transacción: los lugares derivados se crean DENTRO de ella (con la conexión) y, si las paradas fallan, rollback total", async () => {
    vi.mocked(guardarParadasPlan).mockResolvedValue({ ok: false, error: "falló" } as never);
    const res = await post({ fechaPlan: FECHA, horaCarga: "08:00", paradas: [P_CARGA, P_DESC] });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(conexion.rollback).toHaveBeenCalled();
    expect(conexion.commit).not.toHaveBeenCalled();
    for (const llamada of vi.mocked(upsertLugar).mock.calls) expect(llamada[3]).toBe(conexion);
    const orden = [conexion.beginTransaction.mock.invocationCallOrder[0], vi.mocked(upsertLugar).mock.invocationCallOrder[0]];
    expect(orden[0]).toBeLessThan(orden[1]); // upsert después de beginTransaction
  });
});

describe("PATCH — editar paradas re-deriva carga, descarga y snapshot en la misma transacción", () => {
  it("7-10) viaje guardado Carga A / Descarga B -> A2 / B2: ids y snapshot nuevos; no reaparece B", async () => {
    paradasActuales = [{ lugar_nombre: "BODEGAS CALSA, ZONA 12", tipo: "Carga" }, { lugar_nombre: "CD WALMART, VILLA NUEVA", tipo: "Descarga" }];
    historicoActual = "CD WALMART, VILLA NUEVA"; // seguía a la parada
    const paradas = [{ id: 1, lugarNombre: "BODEGA NUEVA", tipo: "Carga" }, { id: 2, lugarNombre: "DESCARGA B2", tipo: "Descarga" }];
    expect((await patch({ id: 5, paradas })).status).toBe(200);
    expect(historicoPatch()).toEqual({ toca: true, valor: "DESCARGA B2" });
    expect(lugaresUpdate()![1]).toEqual([12, 23, 5, 7]); // lugar_carga_id = A2, lugar_descarga_id = B2
    expect(guardarParadasPlan).toHaveBeenCalledWith(7, 5, paradas, conexion);
    expect(conexion.commit).toHaveBeenCalled();
  });
  it("una descripción DISTINTA ya guardada (VIAT-4b) no se pisa al editar las paradas", async () => {
    paradasActuales = [{ lugar_nombre: "BODEGAS CALSA, ZONA 12", tipo: "Carga" }, { lugar_nombre: "CD WALMART, VILLA NUEVA", tipo: "Descarga" }];
    historicoActual = "RUTA-A - Calsa-Walmart-Villa Nueva";
    expect((await patch({ id: 5, paradas: [{ id: 1, lugarNombre: "BODEGAS CALSA, ZONA 12", tipo: "Carga" }, { id: 2, lugarNombre: "DESCARGA B2", tipo: "Descarga" }] })).status).toBe(200);
    expect(historicoPatch().toca).toBe(false);
    expect(lugaresUpdate()![1]).toEqual([11, 23, 5, 7]); // pero el id de descarga sí sigue a la parada
  });
  it("quitar la descripción distinta (null) vuelve a seguir a las paradas", async () => {
    paradasActuales = [{ lugar_nombre: "CD WALMART, VILLA NUEVA", tipo: "Descarga" }];
    historicoActual = "RUTA-A - otro texto";
    expect((await patch({ id: 5, lugarDescargaHistorico: null })).status).toBe(200);
    expect(historicoPatch()).toEqual({ toca: true, valor: "CD WALMART, VILLA NUEVA" });
  });
  it("descripción distinta enviada explícitamente se escribe tal cual", async () => {
    expect((await patch({ id: 5, lugarDescargaHistorico: "RUTA-B - x-y-z" })).status).toBe(200);
    expect(historicoPatch()).toEqual({ toca: true, valor: "RUTA-B - x-y-z" });
  });
  it("15) viaje HISTÓRICO sin paradas: editar otros datos no toca el snapshot, y agregar paradas tampoco lo pierde", async () => {
    historicoActual = "Destino histórico";
    paradasActuales = [];
    expect((await patch({ id: 5, notas: "x" })).status).toBe(200);
    expect(historicoPatch().toca).toBe(false);
    conexion.execute.mockClear();
    expect((await patch({ id: 5, paradas: [P_CARGA, P_DESC] })).status).toBe(200);
    expect(historicoPatch().toca).toBe(false); // el snapshot existente no se borra ni se sustituye en silencio
  });
  it("sin tocar paradas ni destino no se re-derivan lugares ni snapshot", async () => {
    expect((await patch({ id: 5, horaCarga: "06:30" })).status).toBe(200);
    expect(historicoPatch().toca).toBe(false);
    expect(lugaresUpdate()).toBeUndefined();
    expect(guardarParadasPlan).not.toHaveBeenCalled();
  });
  it("quitar la ruta descarta la descripción de la ruta anterior y vuelve a la descarga de las paradas", async () => {
    paradasActuales = [{ lugar_nombre: "CD WALMART, VILLA NUEVA", tipo: "Descarga" }];
    historicoActual = "RUTA-A - Calsa-Walmart-Villa Nueva";
    expect((await patch({ id: 5, rutaId: null })).status).toBe(200);
    expect(historicoPatch()).toEqual({ toca: true, valor: "CD WALMART, VILLA NUEVA" });
  });
  it("16) si guardar paradas falla: rollback total (no queda solo el snapshot ni los lugares)", async () => {
    vi.mocked(guardarParadasPlan).mockResolvedValue({ ok: false, error: "tiene evidencia" } as never);
    expect((await patch({ id: 5, paradas: [{ lugarNombre: "X", tipo: "Descarga" }] })).status).toBe(409);
    expect(conexion.rollback).toHaveBeenCalled();
    expect(conexion.commit).not.toHaveBeenCalled();
    expect(lugaresUpdate()).toBeUndefined();
  });
});

describe("consumidores intactos (lectura de las mismas columnas)", () => {
  const leer = (p: string) => readFileSync(p, "utf8");
  it("13) el reporte tradicional sigue leyendo lugar_descarga_historico (columna y formato sin cambios)", () => {
    const r = leer("src/app/api/empresas/[slug]/tms/programacion/reporte/route.ts");
    expect(r).toContain("p.lugar_descarga_historico");
    expect(r).toContain("r.lugar_descarga_historico ? String(r.lugar_descarga_historico)");
  });
  it("14) el Portal del piloto y la búsqueda de salida siguen leyendo lugar_carga_id / lugar_descarga_id", () => {
    expect(leer("src/lib/flota/viajes-piloto.ts")).toContain("ld ON ld.id = p.lugar_descarga_id");
    expect(leer("src/lib/tms/planes-salida.ts")).toContain("lc ON lc.id = p.lugar_carga_id");
    expect(leer("src/app/api/portal/viajes/route.ts")).toContain("ld ON ld.id = p.lugar_descarga_id");
  });
});
