import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * PROGRAMACION-PERSISTENCIA — PATCH /tms/planes: lo que el usuario edita en un viaje (hora, destino, paradas,
 * contacto) persiste y es lo que vuelve a leer el formulario. Se ejercita el handler REAL; solo se sustituye la E/S.
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
  upsertLugar: vi.fn(async (_e: number, nombre: string | undefined) => (nombre?.trim() ? (nombre.includes("Villa Nueva") ? 902 : 901) : null)),
  guardarAuxiliaresPlan: vi.fn(() => Promise.resolve()),
}));
vi.mock("@/lib/tms/personal-resolucion", () => ({ personalDesdeEmpleado: vi.fn(() => Promise.resolve(null)), validarPersonalId: vi.fn() }));

import { execute, getPool, query } from "@/lib/db";
import { requireTenantProgramacion } from "@/lib/tenant";
import { guardarParadasPlan } from "@/lib/tms/paradas";
import { upsertLugar } from "@/lib/tms/plan-comunes";
import { PATCH } from "./route";

const ctx = { params: Promise.resolve({ slug: "kt" }) };
const patch = (body: unknown) => PATCH(new Request("http://x/api", { method: "PATCH", body: JSON.stringify(body) }), ctx);
const FECHA = "2026-12-15";
let plan: Record<string, unknown>;

function crearConexion() {
  return {
    beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(),
    query: vi.fn(async (sql: string) => (String(sql).includes("GET_LOCK") ? [[{ l: 1 }]] : [[]])),
    execute: vi.fn<(sql: string, params?: unknown[]) => Promise<unknown[]>>(async () => [{ insertId: 1, affectedRows: 1 }]),
  };
}
let conexion: ReturnType<typeof crearConexion>;
const updates = () => conexion.execute.mock.calls.filter((c) => String(c[0]).includes("UPDATE tms_planes_viaje")) as unknown as [string, unknown[]][];
const updatePrincipal = () => updates().find((c) => c[0].includes("UPDATE tms_planes_viaje SET\n"))!;
/** Valor que el UPDATE principal escribe en `columna` (resuelve CASE WHEN ? THEN NULL ELSE COALESCE(?, col)). */
function valorEscrito(columna: string): { toca: boolean; valor: unknown } {
  const [sql, params] = updatePrincipal();
  const linea = sql.split("\n").find((l) => l.trim().startsWith(`${columna} =`))!;
  const antes = (sql.slice(0, sql.indexOf(linea)).match(/\?/g) ?? []).length;
  const n = (linea.match(/\?/g) ?? []).length;
  const ps = params.slice(antes, antes + n);
  if (/COALESCE\(\?, /.test(linea) && n === 1) return { toca: ps[0] != null, valor: ps[0] };
  if (/CASE WHEN \? THEN NULL ELSE COALESCE\(\?,/.test(linea)) return ps[0] ? { toca: true, valor: null } : { toca: ps[1] != null, valor: ps[1] };
  if (/CASE WHEN \? THEN \? ELSE/.test(linea)) return { toca: Boolean(ps[0]), valor: ps[1] };
  throw new Error(`forma no reconocida: ${linea}`);
}

beforeEach(() => {
  vi.resetAllMocks();
  conexion = crearConexion();
  plan = {
    id: 5, codigo: "PLAN-5", estado: "Programado", fecha_plan: FECHA, hora_carga: "04:00:00", notas: null, piloto_id: null, unidad_id: null,
    regreso_estimado: null, ruta_id: 8, tipo_viaje: "Propio", tc_vehiculo_id: null, cliente_id: 3, cliente_nombre: "ACME",
    tarifa_comercial: 1250, tarifa_id: null, costo_operativo_referencia: null, referencia_cliente: null, placa: null, flota_vehiculo_id: null,
    piloto: null, pendiente_cierre: 0,
  };
  vi.mocked(requireTenantProgramacion).mockResolvedValue({ error: null, empresa: { id: 7, nombre: "KT" }, session: { username: "ops", id: 3 } } as never);
  vi.mocked(getPool).mockReturnValue({ getConnection: vi.fn().mockResolvedValue(conexion) } as never);
  vi.mocked(execute).mockResolvedValue({ insertId: 1, affectedRows: 1 } as never);
  vi.mocked(query).mockImplementation((async (sql: string) => (String(sql).includes("FROM tms_planes_viaje p") && String(sql).includes("LIMIT 1") ? [plan] : [])) as never);
  vi.mocked(guardarParadasPlan).mockResolvedValue({ ok: true } as never);
  vi.mocked(upsertLugar).mockImplementation((async (_e: number, nombre: string | undefined) => (nombre?.trim() ? (nombre.includes("Villa Nueva") ? 902 : 901) : null)) as never);
});

describe("PATCH — hora y destino editados para ESTE viaje", () => {
  it("7) hora: 04:00 (de la ruta) -> 06:30 se escribe tal cual", async () => {
    expect((await patch({ id: 5, horaCarga: "06:30" })).status).toBe(200);
    expect(valorEscrito("hora_carga")).toEqual({ toca: true, valor: "06:30" });
  });
  it("6) destino: Mixco (de la ruta) -> Villa Nueva se escribe en lugar_descarga_historico", async () => {
    expect((await patch({ id: 5, lugarDescargaHistorico: "Villa Nueva" })).status).toBe(200);
    expect(valorEscrito("lugar_descarga_historico")).toEqual({ toca: true, valor: "Villa Nueva" });
  });
  it("6) destino BORRADO por el usuario (null) se limpia de verdad — antes no había forma de vaciarlo", async () => {
    expect((await patch({ id: 5, lugarDescargaHistorico: null })).status).toBe(200);
    expect(valorEscrito("lugar_descarga_historico")).toEqual({ toca: true, valor: null });
  });
  it("contacto borrado (null) se limpia; ausente no se toca", async () => {
    expect((await patch({ id: 5, contactoNombreHistorico: null })).status).toBe(200);
    expect(valorEscrito("contacto_nombre_historico")).toEqual({ toca: true, valor: null });
    expect(valorEscrito("contacto_cargo_historico").toca).toBe(false);
  });
  it("campos AUSENTES no se tocan (no se reescriben snapshots viejos)", async () => {
    expect((await patch({ id: 5, notas: "x" })).status).toBe(200);
    for (const c of ["hora_carga", "lugar_descarga_historico", "ruta_codigo_historico", "contacto_nombre_historico"]) {
      expect(valorEscrito(c).toca, c).toBe(false);
    }
  });
});

describe("PATCH — paradas editadas y lugares de carga/descarga del viaje", () => {
  it("10/13) editar la parada de carga/descarga actualiza TAMBIÉN lugar_carga_id/lugar_descarga_id (Portal del piloto lee esas columnas)", async () => {
    const paradas = [
      { id: 1, lugarNombre: "Bodega Central", tipo: "Carga", requiereEvidencia: true },
      { id: 2, lugarNombre: "Villa Nueva", tipo: "Descarga", requiereEvidencia: true },
    ];
    expect((await patch({ id: 5, paradas })).status).toBe(200);
    expect(guardarParadasPlan).toHaveBeenCalledWith(7, 5, paradas, conexion);
    const lugares = updates().find((c) => c[0].includes("lugar_carga_id = ?"));
    expect(lugares).toBeDefined();
    expect(lugares![1]).toEqual([901, 902, 5, 7]);
  });
  it("sin paradas en el PATCH no se tocan las paradas ni los lugares", async () => {
    expect((await patch({ id: 5, horaCarga: "06:30" })).status).toBe(200);
    expect(guardarParadasPlan).not.toHaveBeenCalled();
    expect(updates().some((c) => c[0].includes("lugar_carga_id = ?"))).toBe(false);
  });
  it("si guardar paradas falla (evidencia), no se actualizan los lugares (rollback)", async () => {
    vi.mocked(guardarParadasPlan).mockResolvedValue({ ok: false, error: "tiene evidencia" } as never);
    expect((await patch({ id: 5, paradas: [{ lugarNombre: "X", tipo: "Carga" }] })).status).toBe(409);
    expect(updates().some((c) => c[0].includes("lugar_carga_id = ?"))).toBe(false);
    expect(conexion.rollback).toHaveBeenCalled();
  });
});
