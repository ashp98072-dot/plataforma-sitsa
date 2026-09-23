import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * PROGRAMACION-VIAJES-TERCERIZADOS-1 (ticket sección 27) — cobertura
 * dedicada de POST/PATCH /tms/planes para 'Tercerizado': texto libre en
 * piloto/auxiliares/unidad, SIN tocar catálogos internos (tms_personal/
 * tms_unidades), SIN disponibilidad interna, SIN viáticos generados, y el
 * cambio de tipo (Propio <-> Tercerizado) vía patchTipoViaje(). Mismo
 * patrón de mocking que regreso-opcional.test.ts (misma carpeta) — se
 * ejercita el handler REAL, solo se sustituyen sus dependencias de I/O.
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
vi.mock("@/lib/tms/codigo-plan", () => ({ asegurarCodigoPlanUnico: vi.fn(() => Promise.resolve("PLAN-20260930-001")), generarCodigoPlan: vi.fn() }));
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
vi.mock("@/lib/tms/personal-resolucion", () => ({ personalDesdeEmpleado: vi.fn(() => Promise.resolve(null)), validarPersonalId: vi.fn() }));

import { execute, getPool, query } from "@/lib/db";
import { requireTenantProgramacion } from "@/lib/tenant";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import { guardarAuxiliaresPlan } from "@/lib/tms/plan-comunes";
import { sincronizarViaticosPlan } from "@/lib/tms/viaticos";
import { POST, PATCH } from "./route";

const ctx = { params: Promise.resolve({ slug: "kt-monaco" }) };
const post = (body: unknown) => POST(new Request("http://x/api", { method: "POST", body: JSON.stringify(body) }), ctx);
const patch = (body: unknown) => PATCH(new Request("http://x/api", { method: "PATCH", body: JSON.stringify(body) }), ctx);

let sqlDeConsultas: { sql: string; params: unknown[] }[] = [];
let conexion: ReturnType<typeof crearConexion>;

function crearConexion() {
  return {
    beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(),
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      if (String(sql).includes("GET_LOCK")) return [[{ l: 1 }]];
      sqlDeConsultas.push({ sql: String(sql), params });
      return [[]];
    }),
    execute: vi.fn<(sql: string, params?: unknown[]) => Promise<unknown[]>>(async (sql: string, params: unknown[] = []) => {
      sqlDeConsultas.push({ sql: String(sql), params });
      return [{ insertId: 55, affectedRows: 1 }];
    }),
  };
}

const insertPlan = () => conexion.execute.mock.calls.find((c) => String(c[0]).includes("INSERT INTO tms_planes_viaje")) as unknown as [string, unknown[]] | undefined;
const insertPlanUpdate = () => conexion.execute.mock.calls.find((c) => String(c[0]).includes("UPDATE tms_planes_viaje")) as unknown as [string, unknown[]] | undefined;

beforeEach(() => {
  vi.resetAllMocks();
  sqlDeConsultas = [];
  conexion = crearConexion();
  vi.mocked(requireTenantProgramacion).mockResolvedValue({ error: null, empresa: { id: 7, nombre: "KT" }, session: { username: "ops", id: 3 } } as never);
  vi.mocked(getPool).mockReturnValue({ getConnection: vi.fn().mockResolvedValue(conexion) } as never);
  vi.mocked(execute).mockImplementation((async (sql: string, params: unknown[] = []) => {
    sqlDeConsultas.push({ sql: String(sql), params });
    return { insertId: 91, affectedRows: 1 };
  }) as never);
  vi.mocked(query).mockImplementation((async (sql: string, params: unknown[] = []) => {
    sqlDeConsultas.push({ sql: String(sql), params });
    return [];
  }) as never);
});

const PLAN_TERCERIZADO_BASE = {
  fechaPlan: "2026-09-30",
  horaCarga: "08:00",
  tipoViaje: "Tercerizado",
  pilotoExternoNombre: "Juan Externo",
  auxiliaresExternos: ["Aux Externo 1", "Aux Externo 2"],
  unidadExternaPlaca: "ext-999",
  unidadExternaDescripcion: "Rastra 40'",
  transportistaExterno: "Transportes ABC",
  costoTercerizado: 1500,
};

describe("POST /tms/planes — Tercerizado: texto libre, sin catálogos internos", () => {
  it("crea el plan con tipo_viaje='Tercerizado' y el snapshot de texto guardado (piloto_id/auxiliar_id/unidad_id en NULL)", async () => {
    const res = await post(PLAN_TERCERIZADO_BASE);
    expect(res.status).toBe(200);
    const [, params] = insertPlan()!;
    // Índices del INSERT (ver route.ts): 5=unidad_id, 6=piloto_id, 7=auxiliar_id,
    // 26=tipo_viaje, 27=piloto_externo_nombre, 28=auxiliares_externos,
    // 29=unidad_externa_placa, 30=unidad_externa_descripcion,
    // 31=transportista_externo, 32=costo_tercerizado.
    expect(params[5]).toBeNull();
    expect(params[6]).toBeNull();
    expect(params[7]).toBeNull();
    expect(params[26]).toBe("Tercerizado");
    expect(params[27]).toBe("Juan Externo");
    expect(params[28]).toBe("Aux Externo 1\nAux Externo 2");
    expect(params[29]).toBe("EXT-999");
    expect(params[30]).toBe("Rastra 40'");
    expect(params[31]).toBe("Transportes ABC");
    expect(params[32]).toBe(1500);
  });

  it("un Tercerizado sin nombre de piloto externo se rechaza (400), nunca se crea el plan", async () => {
    const res = await post({ ...PLAN_TERCERIZADO_BASE, pilotoExternoNombre: "" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("piloto externo");
    expect(insertPlan()).toBeUndefined();
  });

  it("NUNCA crea un tms_personal ni un tms_unidades para el recurso externo (sección 24, MUY IMPORTANTE)", async () => {
    await post(PLAN_TERCERIZADO_BASE);
    const insertsCatalogo = sqlDeConsultas.filter((c) => /INSERT INTO tms_personal|INSERT INTO tms_unidades/.test(c.sql));
    expect(insertsCatalogo).toEqual([]);
  });

  it("NO ejecuta la búsqueda de conflictos de disponibilidad interna (piloto/auxiliar/unidad vacíos => sin traslapes que validar)", async () => {
    await post(PLAN_TERCERIZADO_BASE);
    expect(sqlDeConsultas.find((c) => c.sql.includes("FROM tms_personal tp"))).toBeUndefined();
  });

  it("sincroniza viáticos con recursos vacíos (piloto null, auxiliares []) — CERO viáticos internos generados", async () => {
    await post(PLAN_TERCERIZADO_BASE);
    expect(sincronizarViaticosPlan).toHaveBeenCalledWith(
      7,
      expect.any(Number),
      { piloto: null, auxiliares: [] },
      expect.anything(),
      expect.anything(),
    );
  });

  it("guarda tms_plan_auxiliares vacío (sin auxiliares internos, aunque haya auxiliares externos de texto)", async () => {
    await post(PLAN_TERCERIZADO_BASE);
    expect(guardarAuxiliaresPlan).toHaveBeenCalledWith(expect.any(Number), [], expect.anything());
  });

  it("el viaje Tercerizado se puede crear sin transportista ni costo (ambos opcionales)", async () => {
    const { transportistaExterno, costoTercerizado, ...sinOpcionales } = PLAN_TERCERIZADO_BASE;
    void transportistaExterno; void costoTercerizado;
    const res = await post(sinOpcionales);
    expect(res.status).toBe(200);
    const [, params] = insertPlan()!;
    expect(params[31]).toBeNull();
    expect(params[32]).toBeNull();
  });

  it("tipoViaje ausente equivale a 'Propio' (compatibilidad, comportamiento de siempre)", async () => {
    const res = await post({ fechaPlan: "2026-09-30", horaCarga: "08:00", pilotoNombre: "Piloto Interno" });
    expect(res.status).toBe(200);
    const [, params] = insertPlan()!;
    expect(params[26]).toBe("Propio");
    expect(params[27]).toBeNull();
  });

  it("aislamiento por empresa: el plan Tercerizado se crea con el empresa_id de la sesión, no uno enviado por el cliente", async () => {
    await post({ ...PLAN_TERCERIZADO_BASE, empresaId: 999 } as never);
    const [, params] = insertPlan()!;
    expect(params[0]).toBe(7);
  });
});

describe("PATCH /tms/planes — patchTipoViaje: cambio de tipo aislado", () => {
  const filaPlan = (over: Record<string, unknown> = {}) => ({ id: 40, codigo: "PLAN-40", estado: "Programado", tipo_viaje: "Propio", ...over });
  const usarPlan = (fila: Record<string, unknown>) => {
    vi.mocked(query).mockImplementation((async (sql: string, params: unknown[] = []) => {
      sqlDeConsultas.push({ sql: String(sql), params });
      if (String(sql).includes("SELECT id, codigo, estado, tipo_viaje FROM tms_planes_viaje")) return [fila];
      return [];
    }) as never);
  };

  it("Propio -> Tercerizado: limpia ids internos, guarda snapshot, vacía auxiliares y sincroniza viáticos vacíos", async () => {
    usarPlan(filaPlan());
    const res = await patch({ id: 40, tipoViaje: "Tercerizado", pilotoExternoNombre: "Juan Externo", auxiliaresExternos: ["Aux 1"], unidadExternaPlaca: "ext-1" });
    expect(res.status).toBe(200);
    const [sql, params] = insertPlanUpdate()!;
    expect(sql).toContain("tipo_viaje = 'Tercerizado'");
    expect(sql).toContain("piloto_id = NULL, auxiliar_id = NULL, unidad_id = NULL");
    expect(params).toContain("Juan Externo");
    expect(params).toContain("EXT-1");
    expect(guardarAuxiliaresPlan).toHaveBeenCalledWith(40, [], conexion);
    expect(sincronizarViaticosPlan).toHaveBeenCalledWith(7, 40, { piloto: null, auxiliares: [] }, conexion);
    expect(conexion.commit).toHaveBeenCalled();
  });

  it("Propio -> Tercerizado sin piloto externo: 400, no toca la fila (sin UPDATE, sin commit)", async () => {
    usarPlan(filaPlan());
    const res = await patch({ id: 40, tipoViaje: "Tercerizado" });
    expect(res.status).toBe(400);
    expect(insertPlanUpdate()).toBeUndefined();
    expect(conexion.commit).not.toHaveBeenCalled();
  });

  it("Tercerizado -> Propio: limpia los 6 campos de snapshot externo y NO toca auxiliares/viáticos (los resuelve el PATCH normal aparte)", async () => {
    usarPlan(filaPlan({ tipo_viaje: "Tercerizado" }));
    const res = await patch({ id: 40, tipoViaje: "Propio" });
    expect(res.status).toBe(200);
    const [sql, params] = insertPlanUpdate()!;
    expect(sql).toContain("tipo_viaje = 'Propio'");
    expect(sql).toContain("piloto_externo_nombre = NULL");
    expect(params).toEqual([40, 7]);
    expect(guardarAuxiliaresPlan).not.toHaveBeenCalled();
    expect(sincronizarViaticosPlan).not.toHaveBeenCalled();
  });

  it("nunca mezcla: el UPDATE a Tercerizado siempre limpia piloto_id/auxiliar_id/unidad_id en la misma sentencia", async () => {
    usarPlan(filaPlan());
    await patch({ id: 40, tipoViaje: "Tercerizado", pilotoExternoNombre: "X" });
    const [sql] = insertPlanUpdate()!;
    expect(sql).toMatch(/piloto_id = NULL.*auxiliar_id = NULL.*unidad_id = NULL/);
  });

  it("un plan Cerrado no puede cambiar de tipo (400), sin importar el destino", async () => {
    usarPlan(filaPlan({ estado: "Cerrado" }));
    const res = await patch({ id: 40, tipoViaje: "Tercerizado", pilotoExternoNombre: "X" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("Cerrado");
    expect(insertPlanUpdate()).toBeUndefined();
  });

  it("plan de OTRA empresa (o inexistente): 404, sin fuga de datos entre empresas", async () => {
    vi.mocked(query).mockResolvedValue([] as never);
    const res = await patch({ id: 999, tipoViaje: "Tercerizado", pilotoExternoNombre: "X" });
    expect(res.status).toBe(404);
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(String(sql)).toContain("empresa_id = ?");
    expect(params).toContain(7);
  });

  it("registra auditoría con el tipo anterior y el nuevo (sección 22)", async () => {
    usarPlan(filaPlan());
    await patch({ id: 40, tipoViaje: "Tercerizado", pilotoExternoNombre: "Juan Externo" });
    expect(registrarAuditoriaTx).toHaveBeenCalledWith(
      conexion,
      expect.objectContaining({ empresaId: 7, detalle: expect.stringContaining("Propio -> Tercerizado") }),
    );
  });

  it("un PATCH sin tipoViaje sigue el flujo normal (no entra a patchTipoViaje, no dispara su SELECT dedicado)", async () => {
    vi.mocked(query).mockImplementation((async (sql: string, params: unknown[] = []) => {
      sqlDeConsultas.push({ sql: String(sql), params });
      if (String(sql).includes("FROM tms_planes_viaje p") && String(sql).includes("WHERE p.id = ?")) {
        return [{ id: 40, codigo: "PLAN-40", estado: "Programado", fecha_plan: "2026-09-30", hora_carga: "08:00:00", placa: "", piloto: "Piloto Uno", piloto_id: 12, unidad_id: null, regreso_estimado: null, tarifa_comercial: null, costo_operativo_referencia: null, referencia_cliente: null, flota_vehiculo_id: null, pendiente_cierre: 0, ruta_id: null, tarifa_id: null, notas: null }];
      }
      return [];
    }) as never);
    const res = await patch({ id: 40, notas: "Actualiza notas" });
    expect(res.status).toBe(200);
    expect(sqlDeConsultas.find((c) => c.sql.includes("SELECT id, codigo, estado, tipo_viaje FROM tms_planes_viaje"))).toBeUndefined();
  });
});
