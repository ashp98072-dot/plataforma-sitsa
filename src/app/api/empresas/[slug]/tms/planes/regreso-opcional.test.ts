import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * PROGRAMACIÓN — regreso estimado OPCIONAL. Prueba de comportamiento de POST/PATCH /tms/planes con la validación
 * de traslapes REAL (disponibilidad-traslapes.ts) sobre una base simulada: se inspeccionan el SQL y los
 * parámetros que se enviarían, y lo que se guardaría en regreso_estimado.
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
import { personalDesdeEmpleado } from "@/lib/tms/personal-resolucion";
import { emularConsultaConflictoPersonal, type ModeloPersonal } from "@/lib/tms/personal-identidad.fixture";
import { POST, PATCH } from "./route";

const ctx = { params: Promise.resolve({ slug: "kt-monaco" }) };
const post = (body: unknown) => POST(new Request("http://x/api", { method: "POST", body: JSON.stringify(body) }), ctx);
const patch = (body: unknown) => PATCH(new Request("http://x/api", { method: "PATCH", body: JSON.stringify(body) }), ctx);

const PLAN_BASE = { fechaPlan: "2026-09-30", horaCarga: "08:00", pilotoNombre: "Piloto Uno", placa: "", lugarCarga: "Bodega", lugarDescarga: "Destino" };

/** Filas candidatas que devolvería la BD al buscar conflictos del piloto. */
let candidatosPiloto: Record<string, unknown>[] = [];
let sqlDeConsultas: { sql: string; params: unknown[] }[] = [];
let conexion: ReturnType<typeof crearConexion>;

function candidatosDelDia(params: unknown[]) {
  const fecha = String(params[1]);
  const id = Number(params[7]);
  return candidatosPiloto.flatMap((r) => {
    const dia = String(r.fecha ?? r.inicio ?? "").slice(0, 10);
    if (dia !== fecha || r.estado === "Cancelado") return [];
    return [{ ...r, recurso_id: r.recurso_id ?? id, nombre: r.nombre ?? r.recurso_nombre, fecha: dia }];
  });
}

function crearConexion() {
  return {
    beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(),
    // El PATCH valida traslapes DENTRO de la transacción (misma conexión): también se registra aquí.
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      if (String(sql).includes("GET_LOCK")) return [[{ l: 1 }]];
      sqlDeConsultas.push({ sql: String(sql), params });
      return [String(sql).includes("FROM tms_personal tp") ? candidatosDelDia(params) : []];
    }),
    execute: vi.fn<(sql: string, params?: unknown[]) => Promise<unknown[]>>(async () => [{ insertId: 55, affectedRows: 1 }]),
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  candidatosPiloto = [];
  sqlDeConsultas = [];
  conexion = crearConexion();
  vi.mocked(requireTenantProgramacion).mockResolvedValue({ error: null, empresa: { id: 7, nombre: "KT" }, session: { username: "ops", id: 3 } } as never);
  vi.mocked(getPool).mockReturnValue({ getConnection: vi.fn().mockResolvedValue(conexion) } as never);
  vi.mocked(execute).mockResolvedValue({ insertId: 91, affectedRows: 1 } as never);
  vi.mocked(query).mockImplementation((async (sql: string, params: unknown[] = []) => {
    sqlDeConsultas.push({ sql: String(sql), params });
    if (String(sql).includes("FROM tms_personal tp")) return candidatosDelDia(params);
    return [];
  }) as never);
});

const insertPlan = () => conexion.execute.mock.calls.find((c) => String(c[0]).includes("INSERT INTO tms_planes_viaje")) as unknown as [string, unknown[]] | undefined;
const consultaTraslapePiloto = () => sqlDeConsultas.find((c) => c.sql.includes("FROM tms_personal tp"));

describe("POST /tms/planes — regreso estimado opcional", () => {
  it("crea un viaje SIN regresoEstimado aunque tenga piloto asignado (ya no da 400) y guarda regreso_estimado = NULL", async () => {
    const res = await post(PLAN_BASE);
    expect(res.status).toBe(200);
    const [, params] = insertPlan()!;
    // Posición 11 (0-based) = regreso_estimado, ver el INSERT: nunca se rellena con una hora inventada.
    expect(params[11]).toBeNull();
    expect(conexion.commit).toHaveBeenCalled();
  });

  it("regresoEstimado vacío/ausente no produce el mensaje de obligatoriedad", async () => {
    for (const cuerpo of [PLAN_BASE, { ...PLAN_BASE, placa: "C-123ABC" }]) {
      const res = await post(cuerpo);
      const texto = JSON.stringify(await res.json().catch(() => ({})));
      expect(texto).not.toContain("Indica el regreso estimado");
      expect(res.status).not.toBe(400);
    }
  });

  it("crear CON regresoEstimado sigue funcionando y se guarda tal cual", async () => {
    const res = await post({ ...PLAN_BASE, regresoEstimado: "2026-09-30T17:30" });
    expect(res.status).toBe(200);
    expect(insertPlan()![1][11]).toBe("2026-09-30 17:30");
  });

  it("un regresoEstimado anterior a la salida se sigue rechazando (400)", async () => {
    const res = await post({ ...PLAN_BASE, regresoEstimado: "2026-09-30T07:00" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("posterior a la salida programada");
  });

  it("sin regreso estimado, se valida solo fecha_plan sin inventar una hora", async () => {
    await post(PLAN_BASE);
    const c = consultaTraslapePiloto()!;
    expect(c.sql).toContain("p.fecha_plan = ?");
    expect(c.sql).not.toMatch(/regreso_estimado\s*<\s*\?/);
    // Ningún parámetro es una hora inventada (+8h, fin de día...): solo el inicio real del viaje.
    expect(c.params).toContain("2026-09-30");
    expect(c.params).not.toContain("2026-09-30 16:00:00");
    expect(c.params).not.toContain("2026-09-30 23:59:59");
  });

  it("con regreso estimado, la disponibilidad sigue dependiendo solo de fecha_plan", async () => {
    await post({ ...PLAN_BASE, regresoEstimado: "2026-09-30T17:30" });
    const c = consultaTraslapePiloto()!;
    expect(c.params).toContain("2026-09-30");
    expect(c.params).not.toContain("2026-09-30 17:30:00");
    expect(c.sql).toContain("p.fecha_plan = ?");
  });

  it("aislamiento por empresa: la búsqueda de conflictos va acotada por empresa_id de la sesión", async () => {
    await post(PLAN_BASE);
    const c = consultaTraslapePiloto()!;
    expect(c.sql).toContain("tp.empresa_id = ?");
    expect(c.sql).toContain("p.empresa_id = tp.empresa_id");
    expect(c.params[0]).toBe(7);
  });

  it("un viaje abierto del día anterior no bloquea", async () => {
    candidatosPiloto = [{
      recurso_nombre: "Piloto Uno", plan_id: 40, codigo: "PLAN-40", estado: "Programado", inicio: "2026-09-29 06:00:00",
      regreso_estimado: null, llegada_tecnica: 0, hora_llegada: null, cerrado_en: null,
    }];
    const res = await post(PLAN_BASE);
    expect(res.status).toBe(200); // viaje del día anterior no bloquea
  });

  it("con regreso estimado, un viaje abierto sin regreso del mismo piloto que inició antes del fin también choca", async () => {
    candidatosPiloto = [{
      recurso_nombre: "Piloto Uno", plan_id: 40, codigo: "PLAN-40", estado: "En ruta", inicio: "2026-09-30 06:00:00",
      regreso_estimado: null, llegada_tecnica: 0, hora_llegada: null, cerrado_en: null,
    }];
    const res = await post({ ...PLAN_BASE, regresoEstimado: "2026-09-30T17:30" });
    expect(res.status).toBe(409);
  });

  it("un conflicto real con regreso estimado mantiene el mensaje de siempre (rango horario)", async () => {
    candidatosPiloto = [{
      recurso_nombre: "Piloto Uno", plan_id: 41, codigo: "PLAN-41", estado: "Programado", inicio: "2026-09-30 07:00:00",
      regreso_estimado: "2026-09-30 12:00:00", llegada_tecnica: 0, hora_llegada: null, cerrado_en: null,
    }];
    const res = await post({ ...PLAN_BASE, regresoEstimado: "2026-09-30T17:30" });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("PLAN-41 para el 30/09/2026");
  });

  it("un viaje Cerrado del mismo día sigue bloqueando", async () => {
    candidatosPiloto = [{
      recurso_nombre: "Piloto Uno", plan_id: 42, codigo: "PLAN-42", estado: "Cerrado", inicio: "2026-09-30 06:00:00",
      regreso_estimado: "2026-09-30 20:00:00", llegada_tecnica: 1, hora_llegada: "2026-09-30 19:00:00", cerrado_en: "2026-10-01 09:00:00",
    }];
    const res = await post(PLAN_BASE);
    expect(res.status).toBe(409);
  });

  it("un viaje CERRADO sin regreso estimado ocupa solo hasta su llegada real (no más allá)", async () => {
    candidatosPiloto = [{
      recurso_nombre: "Piloto Uno", plan_id: 43, codigo: "PLAN-43", estado: "Cerrado", inicio: "2026-09-25 06:00:00",
      regreso_estimado: null, llegada_tecnica: 1, hora_llegada: "2026-09-25 18:00:00", cerrado_en: "2026-10-05 09:00:00",
    }];
    expect((await post(PLAN_BASE)).status).toBe(200); // terminó el 25; el nuevo viaje es el 30
  });

  it("sin viaje sin recursos asignados no se consulta disponibilidad", async () => {
    const res = await post({ fechaPlan: "2026-09-30", horaCarga: "08:00" });
    expect(res.status).toBe(200);
    expect(consultaTraslapePiloto()).toBeUndefined();
  });
});

describe("PATCH /tms/planes — editar y dejar el regreso estimado en null", () => {
  const filaPlan = (over: Record<string, unknown> = {}) => ({
    id: 40, codigo: "PLAN-40", estado: "Programado", fecha_plan: "2026-09-30", hora_carga: "08:00:00", placa: "", piloto: "Piloto Uno",
    piloto_id: 12, unidad_id: null, regreso_estimado: "2026-09-30T17:30", tarifa_comercial: null, costo_operativo_referencia: null,
    referencia_cliente: null, flota_vehiculo_id: null, pendiente_cierre: 0, ruta_id: null, tarifa_id: null, notas: null, ...over,
  });
  const usarPlan = (fila: Record<string, unknown>) => {
    vi.mocked(query).mockImplementation((async (sql: string, params: unknown[] = []) => {
      sqlDeConsultas.push({ sql: String(sql), params });
      if (String(sql).includes("FROM tms_personal tp")) return candidatosDelDia(params);
      if (String(sql).includes("FROM tms_planes_viaje p") && String(sql).includes("WHERE p.id = ?")) return [fila];
      return [];
    }) as never);
  };
  const updatePlan = () => conexion.execute.mock.calls.find((c) => String(c[0]).includes("UPDATE tms_planes_viaje")) as unknown as [string, unknown[]] | undefined;

  it("regresoEstimado: null con piloto asignado no da 400 y guarda NULL (sin inventar una hora)", async () => {
    usarPlan(filaPlan());
    const res = await patch({ id: 40, regresoEstimado: null });
    const texto = JSON.stringify(await res.json().catch(() => ({})));
    expect(texto).not.toContain("Indica el regreso estimado");
    expect(res.status).toBe(200);
    const [sql, params] = updatePlan()!;
    expect(sql).toContain("regreso_estimado = CASE WHEN ? THEN ? ELSE regreso_estimado END");
    const i = params.findIndex((p, k) => p === true && params[k + 1] === null);
    expect(i).toBeGreaterThanOrEqual(0); // (aplicar = true, valor = null)
  });

  it("un plan que ya no tenía regreso estimado se puede seguir editando sin exigirlo", async () => {
    usarPlan(filaPlan({ regreso_estimado: null }));
    const res = await patch({ id: 40, notas: "Actualiza notas" });
    expect(res.status).toBe(200);
  });

  it("al editar sin regreso estimado, se valida la fecha efectiva", async () => {
    usarPlan(filaPlan({ regreso_estimado: null }));
    await patch({ id: 40, fechaPlan: "2026-10-01", horaCarga: "09:00" });
    const c = consultaTraslapePiloto()!;
    expect(c.sql).toContain("p.fecha_plan = ?");
    expect(c.params).toContain("2026-10-01");
    expect(c.params[0]).toBe(7);
    expect(c.sql).toContain("p.id != ?");
  });

  it("editar y dejar null conserva la validación por empresa y excluye al propio plan", async () => {
    usarPlan(filaPlan());
    await patch({ id: 40, regresoEstimado: null, fechaPlan: "2026-10-02" });
    const c = consultaTraslapePiloto()!;
    expect(c.sql).toContain("tp.empresa_id = ?");
    expect(c.params).toContain(40);
  });

  it("editar y conflicto con un viaje abierto de OTRO plan del mismo piloto: 409", async () => {
    usarPlan(filaPlan());
    candidatosPiloto = [{
      recurso_nombre: "Piloto Uno", plan_id: 77, codigo: "PLAN-77", estado: "En ruta", inicio: "2026-10-02 06:00:00",
      regreso_estimado: null, llegada_tecnica: 0, hora_llegada: null, cerrado_en: null,
    }];
    const res = await patch({ id: 40, regresoEstimado: null, fechaPlan: "2026-10-02" });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("PLAN-77");
  });
});

describe("regreso_estimado nunca se rellena con datos reales", () => {
  it("ni el cierre normal ni el manual escriben regreso_estimado, hora_llegada ni km_llegada", () => {
    const fuente = readFileSync("src/lib/tms/cierre-viaje.ts", "utf8");
    expect(fuente).not.toContain("regreso_estimado");
    // hora_llegada / km_llegada solo aparecen en comentarios (documentan que NO se tocan), nunca en un SET.
    expect(fuente).not.toMatch(/SET[^`]*(hora_llegada|km_llegada)/);
    expect(fuente).not.toMatch(/(hora_llegada|km_llegada)\s*=/);
  });

  it("el cierre solo registra estado, cerrado_por y cerrado_en", () => {
    const fuente = readFileSync("src/lib/tms/cierre-viaje.ts", "utf8");
    expect(fuente).toContain("SET p.estado = 'Cerrado', p.cerrado_por = ?, p.cerrado_en = NOW()");
  });

  it("planes/route.ts ya no contiene la exigencia de regreso estimado", () => {
    const fuente = readFileSync("src/app/api/empresas/[slug]/tms/planes/route.ts", "utf8");
    expect(fuente).not.toContain("Indica el regreso estimado");
    expect(fuente).not.toContain("es obligatorio para poder validar disponibilidad");
  });
});

describe("identidad de personal por empleado — POST y PATCH usan la misma regla", () => {
  const juanAux = { id: 10, empresa_id: 7, nombre: "Juan Pérez", tipo: "Auxiliar" as const, id_empleado: 55 };
  const juanPiloto = { id: 22, empresa_id: 7, nombre: "Juan Pérez", tipo: "Piloto" as const, id_empleado: 55 };
  const viajeExistente = { id: 77, empresa_id: 7, codigo: "PLAN-77", estado: "Programado", inicio: "2026-09-30 07:00:00", regreso_estimado: "2026-09-30 12:00:00", auxiliares: [10] };

  /** La búsqueda de conflictos de personal se responde con el emulador de la consulta real sobre un modelo en memoria. */
  function responderConModelo(modelo: ModeloPersonal) {
    const emular = (sql: string, params: unknown[]) => emularConsultaConflictoPersonal(modelo, sql, params);
    vi.mocked(query).mockImplementation((async (sql: string, params: unknown[] = []) => {
      sqlDeConsultas.push({ sql: String(sql), params });
      return String(sql).includes("FROM tms_personal tp") ? emular(String(sql), params) : [];
    }) as never);
    conexion.query.mockImplementation((async (sql: string, params: unknown[] = []) => {
      if (String(sql).includes("GET_LOCK")) return [[{ l: 1 }]];
      sqlDeConsultas.push({ sql: String(sql), params });
      return [String(sql).includes("FROM tms_personal tp") ? emular(String(sql), params) : []];
    }) as never);
  }

  it("POST: el piloto (personal 22, rol Piloto) ya está en un viaje como Auxiliar (personal 10) del mismo empleado: 409", async () => {
    vi.mocked(personalDesdeEmpleado).mockResolvedValue(22);
    responderConModelo({ personal: [juanAux, juanPiloto], planes: [viajeExistente] });
    const res = await post({ ...PLAN_BASE, pilotoNombre: undefined, pilotoEmpleadoId: 55, regresoEstimado: "2026-09-30T17:30" });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("PLAN-77 para el 30/09/2026");
    expect(insertPlan()).toBeUndefined();
  });

  it("POST sin regreso estimado: el mismo empleado con otro rol en un viaje abierto también bloquea", async () => {
    vi.mocked(personalDesdeEmpleado).mockResolvedValue(22);
    responderConModelo({ personal: [juanAux, juanPiloto], planes: [{ ...viajeExistente, regreso_estimado: null, estado: "En ruta" }] });
    const res = await post({ ...PLAN_BASE, pilotoNombre: undefined, pilotoEmpleadoId: 55 });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("PLAN-77 para el 30/09/2026");
  });

  it("POST: un empleado DISTINTO con el mismo nombre no bloquea", async () => {
    vi.mocked(personalDesdeEmpleado).mockResolvedValue(22);
    responderConModelo({
      personal: [juanPiloto, { ...juanAux, id: 40, id_empleado: 77 }],
      planes: [{ ...viajeExistente, auxiliares: [40] }],
    });
    const res = await post({ ...PLAN_BASE, pilotoNombre: undefined, pilotoEmpleadoId: 55, regresoEstimado: "2026-09-30T17:30" });
    expect(res.status).toBe(200);
  });

  it("POST: personal sin id_empleado (creado por nombre) usa el fallback por personal_id exacto", async () => {
    // pilotoNombre => tms_personal nuevo (id 91 = insertId del mock), sin id_empleado.
    responderConModelo({
      personal: [{ id: 91, empresa_id: 7, nombre: "Piloto Uno", tipo: "Piloto", id_empleado: null }, { id: 92, empresa_id: 7, nombre: "Piloto Uno", tipo: "Auxiliar", id_empleado: null }],
      planes: [{ ...viajeExistente, auxiliares: [92] }],
    });
    const res = await post({ ...PLAN_BASE, regresoEstimado: "2026-09-30T17:30" });
    expect(res.status).toBe(200); // 92 es otra fila sin vínculo de empleado: no es la misma persona
  });

  it("POST: aislamiento por empresa — el mismo id_empleado en otra empresa no bloquea", async () => {
    vi.mocked(personalDesdeEmpleado).mockResolvedValue(22);
    responderConModelo({
      personal: [juanPiloto, { ...juanAux, id: 60, empresa_id: 8 }],
      planes: [{ ...viajeExistente, empresa_id: 8, auxiliares: [60] }],
    });
    const res = await post({ ...PLAN_BASE, pilotoNombre: undefined, pilotoEmpleadoId: 55, regresoEstimado: "2026-09-30T17:30" });
    expect(res.status).toBe(200);
    expect(sqlDeConsultas.find((c) => c.sql.includes("FROM tms_personal tp"))!.params.slice(0, 2)).toEqual([7, "2026-09-30"]);
  });

  it("PATCH: al mover el viaje, el piloto (personal 12, empleado 55) choca con un viaje donde el mismo empleado es Auxiliar (personal 10): 409", async () => {
    vi.mocked(query).mockImplementation((async (sql: string, params: unknown[] = []) => {
      sqlDeConsultas.push({ sql: String(sql), params });
      if (String(sql).includes("FROM tms_planes_viaje p") && String(sql).includes("WHERE p.id = ?")) {
        return [{
          id: 40, codigo: "PLAN-40", estado: "Programado", fecha_plan: "2026-09-30", hora_carga: "08:00:00", placa: "", piloto: "Juan Pérez",
          piloto_id: 12, unidad_id: null, regreso_estimado: "2026-09-30T17:30", tarifa_comercial: null, costo_operativo_referencia: null,
          referencia_cliente: null, flota_vehiculo_id: null, pendiente_cierre: 0, ruta_id: null, tarifa_id: null, notas: null,
        }];
      }
      return [];
    }) as never);
    const modelo: ModeloPersonal = {
      personal: [{ ...juanPiloto, id: 12 }, juanAux],
      planes: [{ ...viajeExistente, inicio: "2026-10-02 07:00:00", regreso_estimado: "2026-10-02 12:00:00" }],
    };
    conexion.query.mockImplementation((async (sql: string, params: unknown[] = []) => {
      if (String(sql).includes("GET_LOCK")) return [[{ l: 1 }]];
      sqlDeConsultas.push({ sql: String(sql), params });
      return [String(sql).includes("FROM tms_personal tp") ? emularConsultaConflictoPersonal(modelo, String(sql), params) : []];
    }) as never);
    const res = await patch({ id: 40, fechaPlan: "2026-10-02", horaCarga: "08:00", regresoEstimado: "2026-10-02T11:00" });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("PLAN-77");
    const c = sqlDeConsultas.find((x) => x.sql.includes("FROM tms_personal tp"))!;
    expect(c.sql).toContain("(eq.id = tp.id OR (tp.id_empleado IS NOT NULL AND eq.id_empleado = tp.id_empleado))");
    expect(c.params.slice(0, 2)).toEqual([7, "2026-10-02"]);
  });

  it("planes/route.ts no reimplementa la identidad: usa primerConflictoTraslape en POST y PATCH", () => {
    const fuente = readFileSync("src/app/api/empresas/[slug]/tms/planes/route.ts", "utf8");
    expect((fuente.match(/primerConflictoProgramacionDia\(/g) ?? []).length).toBe(2);
    expect(fuente).not.toContain("eq.id_empleado");
  });
});
