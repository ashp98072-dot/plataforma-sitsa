import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A2.1 — POST/PATCH /tms/planes con la política REAL por intervalos ([fecha+hora, regreso); sin hora o sin regreso =
 * todo fecha_plan) sobre un modelo de BD en memoria. Solo se sustituye la E/S; el motor
 * (disponibilidad-programacion-intervalos.ts) es el de producción. Fechas relativas a hoyLocal().
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
vi.mock("@/lib/tms/codigo-plan", () => ({ asegurarCodigoPlanUnico: vi.fn(() => Promise.resolve("PLAN-NUEVO-001")), generarCodigoPlan: vi.fn() }));
vi.mock("@/lib/tms/paradas", () => ({
  guardarParadasPlan: vi.fn(() => Promise.resolve({ ok: true })),
  listarParadasDePlanes: vi.fn(() => Promise.resolve(new Map())),
}));
vi.mock("@/lib/flota/acceso", () => ({ obtenerVehiculoAccesible: vi.fn() }));
vi.mock("@/lib/flota/pilotos", () => ({ vehiculoPorPlaca: vi.fn() }));
vi.mock("@/lib/tms/viaticos", () => ({
  listarViaticosRechazadosDelPlan: vi.fn(() => Promise.resolve([])),
  personalRecienAsignadoDelPlan: vi.fn(() => []),
  sincronizarViaticosPlan: vi.fn(() => Promise.resolve()),
}));
vi.mock("@/lib/tms/plan-comunes", () => ({ upsertLugar: vi.fn(() => Promise.resolve(1)), guardarAuxiliaresPlan: vi.fn(() => Promise.resolve()) }));
vi.mock("@/lib/tms/personal-resolucion", () => ({ personalDesdeEmpleado: vi.fn(() => Promise.resolve(null)), validarPersonalId: vi.fn() }));

import { execute, getPool, query } from "@/lib/db";
import { requireTenantProgramacion } from "@/lib/tenant";
import { hoyLocal } from "@/lib/rrhh/dates";
import { emularConsultaConflictoPersonal, type ModeloPersonal, type PlanModelo } from "@/lib/tms/personal-identidad.fixture";
import { primerConflictoProgramacionIntervalo } from "@/lib/tms/disponibilidad-programacion-intervalos";
import { POST, PATCH } from "./route";

const ctx = { params: Promise.resolve({ slug: "kt-monaco" }) };
const post = (body: unknown) => POST(new Request("http://x/api", { method: "POST", body: JSON.stringify(body) }), ctx);
const patch = (body: unknown) => PATCH(new Request("http://x/api", { method: "PATCH", body: JSON.stringify(body) }), ctx);
const sumarDias = (fecha: string, n: number) => { const d = new Date(`${fecha}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const D0 = sumarDias(hoyLocal(), 10); // día base futuro (PATCH no edita el pasado)
const D1 = sumarDias(D0, 1);

const PILOTO = { id: 91, empresa_id: 7, nombre: "Piloto Uno", tipo: "Piloto" as const, id_empleado: null };
const AUX = { id: 92, empresa_id: 7, nombre: "Aux Dos", tipo: "Auxiliar" as const, id_empleado: null };
const existente = (over: Partial<PlanModelo> = {}): PlanModelo => ({
  id: 77, empresa_id: 7, codigo: "PLAN-77", estado: "Programado", inicio: `${D0} 05:00:00`, regreso_estimado: `${D0} 08:00:00`, piloto_id: 91, ...over,
});
const POST_BASE = { fechaPlan: D0, pilotoNombre: "Piloto Uno", lugarCarga: "Bodega", lugarDescarga: "Destino" };

let modelo: ModeloPersonal;
let conexion: ReturnType<typeof crearConexion>;
let ultimaVentana: { fecha: string; hora?: string; regreso?: string } | null;

const responder = (sql: string, params: unknown[]) =>
  String(sql).includes("FROM tms_personal tp") ? emularConsultaConflictoPersonal(modelo, String(sql), params) : [];

function crearConexion() {
  return {
    beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(),
    query: vi.fn(async (sql: string, params: unknown[] = []) => (String(sql).includes("GET_LOCK") ? [[{ l: 1 }]] : [responder(String(sql), params)])),
    execute: vi.fn(async (sql: string) => {
      // Un INSERT confirmado pasa a ser visible para la siguiente operación (la segunda ve a la primera).
      if (String(sql).includes("INSERT INTO tms_planes_viaje") && ultimaVentana) {
        modelo.planes.push({
          id: 500 + modelo.planes.length, empresa_id: 7, codigo: `PLAN-NUEVO-${modelo.planes.length}`, estado: "Programado",
          inicio: `${ultimaVentana.fecha} ${ultimaVentana.hora ?? "00:00"}:00`, regreso_estimado: ultimaVentana.regreso ?? null, piloto_id: 91,
          hora_carga: ultimaVentana.hora ? `${ultimaVentana.hora}:00` : null,
        });
      }
      return [{ insertId: 55, affectedRows: 1 }];
    }),
  };
}

const crear = (extra: Record<string, unknown> = {}) => {
  const b = { ...POST_BASE, ...extra } as { fechaPlan: string; horaCarga?: string; regresoEstimado?: string };
  ultimaVentana = { fecha: b.fechaPlan, hora: b.horaCarga, regreso: b.regresoEstimado ? b.regresoEstimado.replace("T", " ") + ":00" : undefined };
  return post(b);
};
const inserts = () => conexion.execute.mock.calls.filter((c) => String(c[0]).includes("INSERT INTO tms_planes_viaje"));

beforeEach(() => {
  vi.resetAllMocks();
  ultimaVentana = null;
  modelo = { personal: [PILOTO, AUX], planes: [existente()] };
  conexion = crearConexion();
  vi.mocked(requireTenantProgramacion).mockResolvedValue({ error: null, empresa: { id: 7, nombre: "KT" }, session: { username: "ops", id: 3, rol: "Operaciones" } } as never);
  vi.mocked(getPool).mockReturnValue({ getConnection: vi.fn().mockResolvedValue(conexion) } as never);
  vi.mocked(execute).mockResolvedValue({ insertId: 91, affectedRows: 1 } as never); // pilotoNombre -> tms_personal 91
  vi.mocked(query).mockImplementation((async (sql: string, params: unknown[] = []) => responder(String(sql), params)) as never);
});

describe("POST — política por intervalos", () => {
  it("1) 05:00-08:00 existente + 08:00-11:00 nuevo: PERMITIDO (intervalos semiabiertos)", async () => {
    const res = await crear({ horaCarga: "08:00", regresoEstimado: `${D0}T11:00` });
    expect(res.status).toBe(200);
    expect(inserts()).toHaveLength(1);
  });

  it("2) 05:00-08:00 existente + 07:59-10:00 nuevo: BLOQUEADO 409 con el mensaje de siempre y sin INSERT", async () => {
    const res = await crear({ horaCarga: "07:59", regresoEstimado: `${D0}T10:00` });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe(`El piloto Piloto Uno ya está asignado al PLAN-77 para el ${D0.split("-").reverse().join("/")}.`);
    expect(inserts()).toHaveLength(0);
  });

  it("10) cruce de medianoche: 22:00 -> 02:00 del día siguiente; 01:00 choca y 02:00 se permite", async () => {
    modelo.planes = [existente({ inicio: `${D0} 22:00:00`, regreso_estimado: `${D1} 02:00:00` })];
    expect((await crear({ fechaPlan: D1, horaCarga: "01:00", regresoEstimado: `${D1}T05:00` })).status).toBe(409);
    expect((await crear({ fechaPlan: D1, horaCarga: "02:00", regresoEstimado: `${D1}T05:00` })).status).toBe(200);
  });

  it("11) existente SIN regreso reserva solo SU día (no el siguiente)", async () => {
    modelo.planes = [existente({ regreso_estimado: null })];
    expect((await crear({ horaCarga: "20:00", regresoEstimado: `${D0}T23:00` })).status).toBe(409); // el día 0 completo
    expect((await crear({ fechaPlan: D1, horaCarga: "01:00", regresoEstimado: `${D1}T03:00` })).status).toBe(200); // el día 1 queda libre
  });

  it("11b/12) nuevo SIN regreso (o SIN hora) reserva TODO su día: choca con un viaje de cualquier hora de ese día", async () => {
    modelo.planes = [existente({ inicio: `${D0} 21:00:00`, regreso_estimado: `${D0} 23:00:00` })];
    expect((await crear({ horaCarga: "05:00" })).status).toBe(409); // sin regreso
    expect((await crear({})).status).toBe(409); // sin hora ni regreso
    expect((await crear({ fechaPlan: D1 })).status).toBe(200); // otro día
  });

  it("13) un plan Cancelado libera el recurso; uno Cerrado sigue reservando su ventana (política de estados existente)", async () => {
    modelo.planes = [existente({ estado: "Cancelado" })];
    expect((await crear({ horaCarga: "06:00", regresoEstimado: `${D0}T07:00` })).status).toBe(200);
    modelo.planes = [existente({ estado: "Cerrado" })];
    expect((await crear({ horaCarga: "06:00", regresoEstimado: `${D0}T07:00` })).status).toBe(409);
  });

  it("14) un viaje Tercerizado no consume recursos internos: no consulta disponibilidad", async () => {
    const res = await post({
      fechaPlan: D0, horaCarga: "06:00", regresoEstimado: `${D0}T07:00`, tipoViaje: "Tercerizado", lugarCarga: "Bodega", lugarDescarga: "Destino",
      pilotoExternoNombre: "Juan Externo", auxiliaresExternos: ["Aux Externo 1"], unidadExternaPlaca: "ext-999",
      unidadExternaDescripcion: "Rastra", transportistaExterno: "Transportes ABC", costoTercerizado: 1500,
    });
    expect(res.status).toBe(200);
    expect(res.status).not.toBe(409);
    expect(vi.mocked(query).mock.calls.filter(([sql]) => String(sql).includes("FROM tms_personal tp"))).toHaveLength(0);
  });

  it("18) concurrencia bajo lock: la segunda operación ve a la primera ya confirmada", async () => {
    const primera = await crear({ fechaPlan: D1, horaCarga: "05:00", regresoEstimado: `${D1}T08:00` });
    expect(primera.status).toBe(200);
    const segunda = await crear({ fechaPlan: D1, horaCarga: "07:00", regresoEstimado: `${D1}T09:00` });
    expect(segunda.status).toBe(409);
    expect((await segunda.json()).error).toContain("PLAN-NUEVO-");
    const tercera = await crear({ fechaPlan: D1, horaCarga: "08:00", regresoEstimado: `${D1}T10:00` });
    expect(tercera.status).toBe(200); // pegada al fin de la primera: permitido
  });

  it("18b) sin el candado no se valida ni se crea nada (GET_LOCK = 0)", async () => {
    vi.mocked(getPool).mockReturnValue({ getConnection: vi.fn().mockResolvedValue({ ...conexion, query: vi.fn(async () => [[{ l: 0 }]]) }) } as never);
    const res = await crear({ horaCarga: "10:00", regresoEstimado: `${D0}T11:00` });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("otra operación en curso");
    expect(inserts()).toHaveLength(0);
  });
});

describe("PATCH — política por intervalos", () => {
  const filaPlan = (over: Record<string, unknown> = {}) => ({
    id: 40, codigo: "PLAN-40", estado: "Programado", fecha_plan: D0, hora_carga: "05:00:00", placa: "", piloto: "Piloto Uno",
    piloto_id: 91, unidad_id: null, regreso_estimado: `${D0} 08:00:00`, tarifa_comercial: null, costo_operativo_referencia: null,
    referencia_cliente: null, flota_vehiculo_id: null, pendiente_cierre: 0, ruta_id: null, tarifa_id: null, notas: null, tipo_viaje: "Propio", tc_vehiculo_id: null, ...over,
  });
  const usarPlan = (fila: Record<string, unknown>, otros: PlanModelo[] = []) => {
    modelo.planes = [{ id: 40, empresa_id: 7, codigo: "PLAN-40", estado: "Programado", inicio: `${D0} 05:00:00`, regreso_estimado: `${D0} 08:00:00`, piloto_id: 91 }, ...otros];
    vi.mocked(query).mockImplementation((async (sql: string, params: unknown[] = []) => {
      if (String(sql).includes("FROM tms_planes_viaje p") && String(sql).includes("WHERE p.id = ?") && String(sql).includes("p.hora_carga")) return [fila];
      return responder(String(sql), params);
    }) as never);
  };
  const update = () => conexion.execute.mock.calls.find((c) => String(c[0]).includes("UPDATE tms_planes_viaje")) as unknown as [string, unknown[]] | undefined;

  it("3) mismo comportamiento que POST: mover a 08:00-11:00 con otro viaje 05:00-08:00 se permite; a 07:59-10:00 se bloquea", async () => {
    usarPlan(filaPlan({ hora_carga: "12:00:00", regreso_estimado: `${D0} 14:00:00` }), [existente({ id: 77 })]);
    expect((await patch({ id: 40, horaCarga: "08:00", regresoEstimado: `${D0}T11:00` })).status).toBe(200);
    expect(update()).toBeDefined();
    conexion.execute.mockClear();
    const res = await patch({ id: 40, horaCarga: "07:59", regresoEstimado: `${D0}T10:00` });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("PLAN-77");
    expect(update()).toBeUndefined();
  });

  it("4) el PATCH autoexcluye su propio plan: cambiar de 05:00-08:00 a 06:00-09:00 no choca consigo mismo", async () => {
    usarPlan(filaPlan());
    expect((await patch({ id: 40, horaCarga: "06:00", regresoEstimado: `${D0}T09:00` })).status).toBe(200);
    const c = conexion.query.mock.calls.find((x) => String(x[0]).includes("FROM tms_personal tp"))!;
    expect(String(c[0])).toMatch(/p\.id NOT IN \(\?\)[\s\S]*FOR UPDATE$/);
    expect((c[1] as unknown[]).at(-1)).toBe(40);
  });

  it("la ventana efectiva mezcla lo enviado con lo guardado (solo cambia el regreso; hora y fecha vienen del plan)", async () => {
    usarPlan(filaPlan(), [existente({ id: 78, inicio: `${D0} 09:00:00`, regreso_estimado: `${D0} 10:00:00` })]);
    expect((await patch({ id: 40, regresoEstimado: `${D0}T09:30` })).status).toBe(409); // 05:00-09:30 pisa 09:00-10:00
    expect((await patch({ id: 40, regresoEstimado: `${D0}T09:00` })).status).toBe(200); // termina justo cuando empieza el otro
  });

  it("11/12) plan guardado sin regreso (o si el PATCH lo deja en null) reserva todo su día", async () => {
    usarPlan(filaPlan({ regreso_estimado: null }), [existente({ id: 77, inicio: `${D0} 21:00:00`, regreso_estimado: `${D0} 23:00:00` })]);
    expect((await patch({ id: 40, notas: "x" })).status).toBe(409);
    usarPlan(filaPlan(), [existente({ id: 77, inicio: `${D0} 21:00:00`, regreso_estimado: `${D0} 23:00:00` })]);
    expect((await patch({ id: 40, regresoEstimado: null })).status).toBe(409);
  });

  it("10) cruce de medianoche en PATCH: 24/09 22:00 -> 25/09 02:00 vs 25/09 01:00 choca, 02:00 no", async () => {
    usarPlan(filaPlan({ fecha_plan: D1, hora_carga: "12:00:00", regreso_estimado: `${D1} 14:00:00` }), [existente({ id: 77, inicio: `${D0} 22:00:00`, regreso_estimado: `${D1} 02:00:00` })]);
    expect((await patch({ id: 40, horaCarga: "01:00", regresoEstimado: `${D1}T05:00` })).status).toBe(409);
    expect((await patch({ id: 40, horaCarga: "02:00", regresoEstimado: `${D1}T05:00` })).status).toBe(200);
  });

  it("13) Cancelado libera (no valida) y un plan Cancelado ajeno tampoco bloquea", async () => {
    usarPlan(filaPlan(), [existente({ id: 77, estado: "Cancelado" })]);
    expect((await patch({ id: 40, horaCarga: "06:00", regresoEstimado: `${D0}T07:00` })).status).toBe(200);
    conexion.query.mockClear();
    expect((await patch({ id: 40, estado: "Cancelado" })).status).toBe(200);
    expect(conexion.query.mock.calls.some((c) => String(c[0]).includes("FROM tms_personal tp"))).toBe(false);
  });

  it("el lock y la revalidación siguen siendo los de siempre: GET_LOCK, FOR UPDATE, rollback ante conflicto", async () => {
    usarPlan(filaPlan({ hora_carga: "12:00:00", regreso_estimado: `${D0} 14:00:00` }), [existente({ id: 77 })]);
    const res = await patch({ id: 40, horaCarga: "07:00", regresoEstimado: `${D0}T09:00` });
    expect(res.status).toBe(409);
    expect(conexion.query.mock.calls.some((c) => String(c[0]).includes("GET_LOCK"))).toBe(true);
    expect(conexion.rollback).toHaveBeenCalled();
    expect(conexion.commit).not.toHaveBeenCalled();
  });
});

describe("auxiliar principal / adicional y política sobre el motor real (personal por id)", () => {
  const ventana = (h: string, r: string) => ({ fechaPlan: D0, horaCarga: h, regresoEstimado: `${D0}T${r}` });
  const usar = (plan: PlanModelo) => {
    modelo = { personal: [PILOTO, AUX], planes: [plan] };
    vi.mocked(query).mockImplementation((async (sql: string, params: unknown[] = []) => responder(String(sql), params)) as never);
  };
  const choca = (h: string, r: string) => primerConflictoProgramacionIntervalo(7, [{ tipo: "auxiliar", id: 92 }], ventana(h, r), []);

  it("6) auxiliar PRINCIPAL (tms_planes_viaje.auxiliar_id) usa intervalos", async () => {
    usar(existente({ piloto_id: null, auxiliar_id: 92 }));
    expect(await choca("07:59", "10:00")).toMatchObject({ planIdConflicto: 77 });
    expect(await choca("08:00", "11:00")).toBeNull();
  });

  it("7) auxiliar ADICIONAL (tms_plan_auxiliares) usa intervalos", async () => {
    usar(existente({ piloto_id: 91, auxiliar_id: null, auxiliares: [92] }));
    expect(await choca("07:59", "10:00")).toMatchObject({ planIdConflicto: 77 });
    expect(await choca("08:00", "11:00")).toBeNull();
  });

  it("5) piloto y auxiliar del mismo empleado (dos filas tms_personal) se tratan como la misma persona", async () => {
    modelo = { personal: [{ ...PILOTO, id_empleado: 55 }, { ...AUX, id_empleado: 55 }], planes: [existente({ piloto_id: 91 })] };
    vi.mocked(query).mockImplementation((async (sql: string, params: unknown[] = []) => responder(String(sql), params)) as never);
    expect(await choca("07:00", "09:00")).toMatchObject({ planIdConflicto: 77 });
  });
});

describe("el POST/PATCH ya no usan la política diaria", () => {
  it("planes/route.ts solo importa el motor por intervalos", async () => {
    const { readFileSync } = await import("node:fs");
    const fuente = readFileSync("src/app/api/empresas/[slug]/tms/planes/route.ts", "utf8");
    expect(fuente).not.toContain("primerConflictoProgramacionDia");
    expect((fuente.match(/primerConflictoProgramacionIntervalo\(/g) ?? []).length).toBe(2);
  });
});
