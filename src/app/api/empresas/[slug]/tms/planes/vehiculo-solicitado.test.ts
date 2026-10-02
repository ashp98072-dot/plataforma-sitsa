import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * PROGRAMACION-VEHICULO-SOLICITADO — POST/PATCH/GET /tms/planes con "Vehículo
 * solicitado por el cliente". Mismo arnés que programacion-tc.test.ts (se
 * ejercita el handler REAL y la política REAL de disponibilidad diaria; solo
 * se sustituye la E/S): se inspeccionan el SQL y los parámetros que se
 * enviarían.
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
vi.mock("@/lib/tms/codigo-plan", () => ({ asegurarCodigoPlanUnico: vi.fn(() => Promise.resolve("PLAN-20260923-001")), generarCodigoPlan: vi.fn() }));
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
vi.mock("@/lib/tms/plan-comunes", () => ({ upsertLugar: vi.fn(() => Promise.resolve(1)), guardarAuxiliaresPlan: vi.fn(() => Promise.resolve()) }));

import { execute, getPool, query } from "@/lib/db";
import { requireTenantProgramacion, requireTenantProgramacionOTms } from "@/lib/tenant";
import { registrarAuditoria } from "@/lib/auditoria";
import { obtenerVehiculoAccesible } from "@/lib/flota/acceso";
import { listarDisponibilidadVehiculos } from "@/lib/operaciones/disponibilidad";
import { GET, POST, PATCH } from "./route";

const ctx = { params: Promise.resolve({ slug: "kt-monaco" }) };
const post = (body: unknown) => POST(new Request("http://x/api", { method: "POST", body: JSON.stringify(body) }), ctx);
const patch = (body: unknown) => PATCH(new Request("http://x/api", { method: "PATCH", body: JSON.stringify(body) }), ctx);

/** Catálogo REUTILIZADO (tms_cotizacion_costeo_perfiles) por empresa: [empresa, id, nombre, activo]. */
const PERFILES: [number, number, string, number][] = [
  [7, 11, "Camión 2.5 toneladas", 1],
  [7, 12, "Camión 5 toneladas", 1],
  [7, 13, "Panel (descontinuado)", 0],
  [8, 99, "Perfil de OTRA empresa", 1],
];
const FECHA = "2026-12-15"; // futura: no choca con la regla de fecha pasada
let planActual: Record<string, unknown>;
let vsActual: { vehiculo_solicitado_perfil_id: number | null; vehiculo_solicitado_nombre: string | null };
let sinColumnas = false;

function responderQuery(sql: string, params: unknown[]): unknown[] {
  if (sinColumnas && sql.includes("vehiculo_solicitado")) throw Object.assign(new Error("Unknown column"), { code: "ER_BAD_FIELD_ERROR", errno: 1054 });
  if (sql.includes("FROM tms_cotizacion_costeo_perfiles")) {
    const [empresa, id] = params as [number, number];
    return PERFILES.filter(([e, i, , a]) => e === empresa && i === id && a === 1).map(([, i, nombre]) => ({ id: i, nombre }));
  }
  if (sql.includes("SELECT vehiculo_solicitado_perfil_id, vehiculo_solicitado_nombre FROM tms_planes_viaje")) return [vsActual];
  if (sql.includes("FROM tms_planes_viaje p") && sql.includes("LIMIT 1")) return [planActual];
  return [];
}

function crearConexion() {
  return {
    beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(),
    query: vi.fn(async (sql: string) => (String(sql).includes("GET_LOCK") ? [[{ l: 1 }]] : [[]])),
    execute: vi.fn<(sql: string, params?: unknown[]) => Promise<unknown[]>>(async () => [{ insertId: 55, affectedRows: 1 }]),
  };
}
let conexion: ReturnType<typeof crearConexion>;
const insertPlan = () => conexion.execute.mock.calls.find((c) => String(c[0]).includes("INSERT INTO tms_planes_viaje")) as unknown as [string, unknown[]] | undefined;
const updatePlan = () => conexion.execute.mock.calls.find((c) => String(c[0]).includes("UPDATE tms_planes_viaje SET")) as unknown as [string, unknown[]] | undefined;
const consultasPerfiles = () => vi.mocked(query).mock.calls.filter((c) => String(c[0]).includes("tms_cotizacion_costeo_perfiles"));

beforeEach(() => {
  vi.resetAllMocks();
  sinColumnas = false;
  conexion = crearConexion();
  planActual = {
    id: 5, codigo: "PLAN-5", estado: "Programado", fecha_plan: FECHA, hora_carga: "08:00:00", notas: null, piloto_id: null, unidad_id: null,
    regreso_estimado: null, ruta_id: null, tipo_viaje: "Propio", tc_vehiculo_id: null, cliente_id: null, cliente_nombre: null,
    tarifa_comercial: 1250, tarifa_id: null, costo_operativo_referencia: null, referencia_cliente: null, placa: null, flota_vehiculo_id: null,
    piloto: null, pendiente_cierre: 0,
  };
  vsActual = { vehiculo_solicitado_perfil_id: 11, vehiculo_solicitado_nombre: "Camión 2.5 toneladas" };
  vi.mocked(requireTenantProgramacion).mockResolvedValue({ error: null, empresa: { id: 7, nombre: "KT" }, session: { username: "ops", id: 3 } } as never);
  vi.mocked(requireTenantProgramacionOTms).mockResolvedValue({ error: null, empresa: { id: 7, nombre: "KT" }, session: { username: "ops", id: 3 } } as never);
  vi.mocked(getPool).mockReturnValue({ getConnection: vi.fn().mockResolvedValue(conexion) } as never);
  vi.mocked(execute).mockResolvedValue({ insertId: 91, affectedRows: 1 } as never);
  vi.mocked(query).mockImplementation((async (sql: string, params: unknown[] = []) => responderQuery(String(sql), params)) as never);
});

describe("POST — crear viaje con vehículo solicitado", () => {
  it("1/2) valida el perfil contra la empresa de la SESIÓN y persiste id + fotografía del nombre", async () => {
    const res = await post({ fechaPlan: FECHA, horaCarga: "08:00", vehiculoSolicitadoPerfilId: 11, empresaId: 8 });
    expect(res.status).toBe(200);
    expect(consultasPerfiles()[0][1]).toEqual([7, 11]);
    const [sql, params] = insertPlan()!;
    expect(sql).toContain("tc_externo_placa, vehiculo_solicitado_perfil_id, vehiculo_solicitado_nombre)");
    expect(params.slice(-2)).toEqual([11, "Camión 2.5 toneladas"]);
    expect((sql.match(/\?/g) ?? []).length).toBe(params.length); // placeholders y parámetros alineados
  });

  it("7/8) solicitado 2.5 t + unidad real 5 t es válido; la tarifa enviada NO se recalcula por la unidad", async () => {
    const res = await post({ fechaPlan: FECHA, horaCarga: "08:00", vehiculoSolicitadoPerfilId: 11, tarifaComercial: 1250 });
    expect(res.status).toBe(200);
    const [, params] = insertPlan()!;
    expect(params[12]).toBe(1250); // tarifa_comercial tal cual
    expect(params.slice(-2)).toEqual([11, "Camión 2.5 toneladas"]);
  });

  it("9) viaje TERCERIZADO conserva el vehículo solicitado (dato comercial, no de flota propia)", async () => {
    const res = await post({
      fechaPlan: FECHA, horaCarga: "08:00", tipoViaje: "Tercerizado", vehiculoSolicitadoPerfilId: 12,
      pilotoExternoNombre: "Juan Externo", unidadExternaPlaca: "EXT-1", transportistaExterno: "Transportes X",
    });
    expect(res.status).toBe(200);
    const [sql, params] = insertPlan()!;
    expect(sql).toContain("vehiculo_solicitado_perfil_id");
    expect(params.slice(-2)).toEqual([12, "Camión 5 toneladas"]);
  });

  it("11) aislamiento: un perfil de OTRA empresa (o inactivo) se rechaza con 400 y no se crea nada", async () => {
    for (const id of [99, 13, 12345]) {
      const res = await post({ fechaPlan: FECHA, horaCarga: "08:00", vehiculoSolicitadoPerfilId: id });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/vehículo solicitado/i);
    }
    expect(insertPlan()).toBeUndefined();
  });

  it("sin vehículo solicitado el INSERT es el de siempre (no nombra las columnas nuevas)", async () => {
    const res = await post({ fechaPlan: FECHA, horaCarga: "08:00" });
    expect(res.status).toBe(200);
    expect(insertPlan()![0]).not.toContain("vehiculo_solicitado");
    expect(consultasPerfiles()).toHaveLength(0);
  });
});

describe("PATCH — editar vehículo solicitado (independiente de unidad/tarifa)", () => {
  it("cambiarlo escribe SOLO sus dos columnas: unidad, tarifa y personal no se tocan", async () => {
    const res = await patch({ id: 5, vehiculoSolicitadoPerfilId: 12 });
    expect(res.status).toBe(200);
    const [sql, params] = updatePlan()!;
    expect(sql).toContain("vehiculo_solicitado_perfil_id = ?, vehiculo_solicitado_nombre = ?");
    expect(params).toContain("Camión 5 toneladas");
    // unidad_id/piloto_id por COALESCE(NULL, ...) => sin cambio; tarifa_comercial con bandera false
    expect(params.slice(0, 4)).toEqual([null, null, null, null]);
    expect(params[7]).toBe(false); // regreso no tocado
    expect(params[9]).toBe(false); // tarifa_comercial NO se toca
    expect((sql.match(/\?/g) ?? []).length).toBe(params.length);
    // bitácora "antes → después"
    const detalles = vi.mocked(registrarAuditoria).mock.calls.map((c) => String((c[0] as { detalle?: string }).detalle));
    expect(detalles.some((d) => d.includes("vehículo solicitado Camión 2.5 toneladas → Camión 5 toneladas"))).toBe(true);
  });

  it("6) cambiar la UNIDAD (5 t en lugar de la solicitada 2.5 t) NO cambia el vehículo solicitado ni la tarifa", async () => {
    vi.mocked(obtenerVehiculoAccesible).mockResolvedValue({ id: 77, placa: "C-500", activo: 1, en_taller: 0, empresa_id: 7 } as never);
    vi.mocked(listarDisponibilidadVehiculos).mockResolvedValue({
      vehiculos: [{ id: 77, placa: "C-500", estadoDisponibilidad: "disponible", viajeAbierto: null, puedeEnviar: true, activo: true, tipoUnidad: "VEHICULO" }],
      resumen: {},
    } as never);
    const res = await patch({ id: 5, flotaVehiculoId: 77, motivoCambio: "No había 2.5 t en el predio" });
    expect(res.status).toBe(200);
    const [sql, params] = updatePlan()!;
    expect(params[3]).not.toBeNull(); // unidad_id SÍ cambia (la unidad real)
    expect(sql).not.toContain("vehiculo_solicitado");
    expect(params[9]).toBe(false); // tarifa_comercial intacta
    expect(consultasPerfiles()).toHaveLength(0);
  });

  it("6) cambiar OTROS datos (tarifa) no cambia el vehículo solicitado", async () => {
    const res = await patch({ id: 5, tarifaComercial: 1300 });
    expect(res.status).toBe(200);
    expect(updatePlan()![0]).not.toContain("vehiculo_solicitado");
  });

  it("null lo quita; el mismo valor actual no reescribe nada", async () => {
    expect((await patch({ id: 5, vehiculoSolicitadoPerfilId: null })).status).toBe(200);
    const [, params] = updatePlan()!;
    const sql = updatePlan()![0];
    const i = (sql.slice(0, sql.indexOf("vehiculo_solicitado_perfil_id = ?")).match(/\?/g) ?? []).length;
    expect(params.slice(i, i + 2)).toEqual([null, null]);

    conexion = crearConexion();
    vi.mocked(getPool).mockReturnValue({ getConnection: vi.fn().mockResolvedValue(conexion) } as never);
    expect((await patch({ id: 5, vehiculoSolicitadoPerfilId: 11 })).status).toBe(200);
    expect(updatePlan()![0]).not.toContain("vehiculo_solicitado_perfil_id = ?");
  });

  it("el valor actual se conserva aunque su perfil ya no esté activo (no se re-valida)", async () => {
    vsActual = { vehiculo_solicitado_perfil_id: 13, vehiculo_solicitado_nombre: "Panel (descontinuado)" };
    expect((await patch({ id: 5, vehiculoSolicitadoPerfilId: 13, tarifaComercial: 1200 })).status).toBe(200);
  });

  it("11) aislamiento: un perfil de otra empresa se rechaza con 400", async () => {
    const res = await patch({ id: 5, vehiculoSolicitadoPerfilId: 99 });
    expect(res.status).toBe(400);
    expect(updatePlan()).toBeUndefined();
  });

  it("14) respeta las reglas por estado vigentes: Cerrado/Cancelado y En ruta sin llegada => 409; pendiente de cierre permitido", async () => {
    for (const estado of ["Cerrado", "Cancelado"]) {
      planActual = { ...planActual, estado };
      expect((await patch({ id: 5, vehiculoSolicitadoPerfilId: 12 })).status).toBe(409);
    }
    planActual = { ...planActual, estado: "En ruta", pendiente_cierre: 0 };
    expect((await patch({ id: 5, vehiculoSolicitadoPerfilId: 12 })).status).toBe(409);
    expect(updatePlan()).toBeUndefined();
    planActual = { ...planActual, estado: "En ruta", pendiente_cierre: 1 };
    expect((await patch({ id: 5, vehiculoSolicitadoPerfilId: 12 })).status).toBe(200);
  });

  it("no se mezcla con el cambio de tipo de viaje (flujo aislado): 400 si llegan juntos", async () => {
    const res = await patch({ id: 5, tipoViaje: "Tercerizado", vehiculoSolicitadoPerfilId: 12 });
    expect(res.status).toBe(400);
  });
});

describe("GET — Programación", () => {
  it("3) trae vehiculo_solicitado_perfil_id/nombre; sin la migración reintenta sin ellas (dato ausente)", async () => {
    vi.mocked(query).mockImplementation((async (sql: string) => {
      if (String(sql).includes("vehiculo_solicitado") && sinColumnas) throw Object.assign(new Error("Unknown column"), { code: "ER_BAD_FIELD_ERROR", errno: 1054 });
      if (String(sql).includes("LEFT JOIN tms_clientes c")) {
        return [{ id: 5, codigo: "PLAN-5", fecha_plan: FECHA, estado: "Programado", ...(sinColumnas ? {} : { vehiculo_solicitado_perfil_id: 11, vehiculo_solicitado_nombre: "Camión 2.5 toneladas" }) }];
      }
      return [];
    }) as never);
    const get = () => GET(new Request(`http://x/api?fechaDesde=${FECHA}&fechaHasta=${FECHA}`), ctx);
    const conDato = (await (await get()).json()).planes[0];
    expect(conDato).toMatchObject({ vehiculo_solicitado_perfil_id: 11, vehiculo_solicitado_nombre: "Camión 2.5 toneladas" });
    sinColumnas = true;
    const res = await get();
    expect(res.status).toBe(200);
    expect((await res.json()).planes[0].vehiculo_solicitado_nombre).toBeUndefined();
  });
});
