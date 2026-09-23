import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * PROGRAMACION-TC-CAJA-REMOLQUE-1 — POST/PATCH /tms/planes con TC / caja /
 * remolque. Mismo arnés que programacion-viajes-tercerizados.test.ts (se
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
vi.mock("@/lib/tms/personal-resolucion", () => ({ personalDesdeEmpleado: vi.fn(() => Promise.resolve(null)), validarPersonalId: vi.fn() }));

import { execute, getPool, query } from "@/lib/db";
import { requireTenantProgramacion } from "@/lib/tenant";
import { listarDisponibilidadVehiculos } from "@/lib/operaciones/disponibilidad";
import { obtenerVehiculoAccesible } from "@/lib/flota/acceso";
import { sincronizarViaticosPlan } from "@/lib/tms/viaticos";
import { POST, PATCH } from "./route";

const ctx = { params: Promise.resolve({ slug: "kt-monaco" }) };
const post = (body: unknown) => POST(new Request("http://x/api", { method: "POST", body: JSON.stringify(body) }), ctx);
const patch = (body: unknown) => PATCH(new Request("http://x/api", { method: "PATCH", body: JSON.stringify(body) }), ctx);

type Consulta = { sql: string; params: unknown[] };
let consultas: Consulta[] = [];
let conexion: ReturnType<typeof crearConexion>;
/** Ocupaciones del TC (filas que devolvería la BD): se filtran por fecha_plan (params[1]) igual que el WHERE real. */
let ocupacionesTc: { recurso_id: number; nombre: string; plan_id: number; codigo: string; fecha: string }[] = [];

function responderTc(sql: string, params: unknown[]) {
  const ids = params.filter((v): v is number => typeof v === "number").slice(-3);
  const excluyeOtro = sql.includes("AND p.id != ?");
  const excluido = excluyeOtro ? (params[params.length - 1] as number) : null;
  return ocupacionesTc.filter((r) => r.fecha === params[1] && ids.includes(r.recurso_id) && (excluido == null || r.plan_id !== excluido));
}

function crearConexion() {
  return {
    beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(),
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      if (String(sql).includes("GET_LOCK")) return [[{ l: 1 }]];
      consultas.push({ sql: String(sql), params });
      if (String(sql).includes("FROM flota_vehiculos v")) return [responderTc(String(sql), params)];
      return [[]];
    }),
    execute: vi.fn<(sql: string, params?: unknown[]) => Promise<unknown[]>>(async (sql: string, params: unknown[] = []) => {
      consultas.push({ sql: String(sql), params });
      return [{ insertId: 55, affectedRows: 1 }];
    }),
  };
}

const insertPlan = () => conexion.execute.mock.calls.find((c) => String(c[0]).includes("INSERT INTO tms_planes_viaje")) as unknown as [string, unknown[]] | undefined;
const updatePlan = () => conexion.execute.mock.calls.find((c) => String(c[0]).includes("UPDATE tms_planes_viaje")) as unknown as [string, unknown[]] | undefined;
const consultaTc = () => consultas.filter((c) => c.sql.includes("FROM flota_vehiculos v"));

const TC_045 = { id: 45, placa: "TC-045", activo: 1, en_taller: 0, tipo_unidad: "TC" };
const usarVehiculos = (vehiculos: Record<number, Record<string, unknown> | null>) =>
  vi.mocked(obtenerVehiculoAccesible).mockImplementation((async (_e: number, id: number) => vehiculos[id] ?? null) as never);

beforeEach(() => {
  vi.resetAllMocks();
  consultas = [];
  ocupacionesTc = [];
  conexion = crearConexion();
  vi.mocked(requireTenantProgramacion).mockResolvedValue({ error: null, empresa: { id: 7, nombre: "KT" }, session: { username: "ops", id: 3 } } as never);
  vi.mocked(getPool).mockReturnValue({ getConnection: vi.fn().mockResolvedValue(conexion) } as never);
  vi.mocked(execute).mockImplementation((async (sql: string, params: unknown[] = []) => {
    consultas.push({ sql: String(sql), params });
    return { insertId: 91, affectedRows: 1 };
  }) as never);
  vi.mocked(query).mockImplementation((async (sql: string, params: unknown[] = []) => {
    consultas.push({ sql: String(sql), params });
    if (String(sql).includes("FROM flota_vehiculos v")) return responderTc(String(sql), params);
    return [];
  }) as never);
  usarVehiculos({ 45: TC_045 });
});

const BASE = { fechaPlan: "2026-09-23", horaCarga: "08:00" };
// Índices de las columnas nuevas en el INSERT (ver route.ts): 5 unidad_id, 33 tc_vehiculo_id, 34 tc_placa_historica, 35 tc_externo_placa.
const IDX = { unidad: 5, tipo: 26, tcId: 33, tcHist: 34, tcExt: 35 };

describe("POST — viaje PROPIO con TC interno", () => {
  it("TC opcional: un viaje sin TC se crea igual que siempre (las 3 columnas TC en NULL, sin consultar el catálogo de TC)", async () => {
    const res = await post({ ...BASE, pilotoNombre: "Piloto Uno" });
    expect(res.status).toBe(200);
    const [, params] = insertPlan()!;
    expect(params[IDX.tcId]).toBeNull();
    expect(params[IDX.tcHist]).toBeNull();
    expect(params[IDX.tcExt]).toBeNull();
    expect(obtenerVehiculoAccesible).not.toHaveBeenCalled();
    expect(consultaTc()).toEqual([]);
  });

  it("guarda tc_vehiculo_id + fotografía de la placa, y NUNCA lo mezcla con unidad_id", async () => {
    const res = await post({ ...BASE, tcVehiculoId: 45 });
    expect(res.status).toBe(200);
    const [, params] = insertPlan()!;
    expect(params[IDX.tcId]).toBe(45);
    expect(params[IDX.tcHist]).toBe("TC-045");
    expect(params[IDX.tcExt]).toBeNull();
    expect(params[IDX.unidad]).toBeNull();
  });

  it("valida el TC en servidor con la empresa de la SESIÓN (aislamiento/accesos de Flota), nunca la que mande el cliente", async () => {
    await post({ ...BASE, tcVehiculoId: 45, empresaId: 999 } as never);
    expect(obtenerVehiculoAccesible).toHaveBeenCalledWith(7, 45, expect.stringContaining("tipo_unidad"));
    expect(consultaTc()[0].params[0]).toBe(7);
  });

  it("un TC de otra empresa / no accesible se rechaza (400) y no se crea el viaje", async () => {
    usarVehiculos({});
    const res = await post({ ...BASE, tcVehiculoId: 45 });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("no es accesible");
    expect(insertPlan()).toBeUndefined();
  });

  it("un vehículo NO clasificado como TC no se acepta como TC (nunca se infiere de la placa)", async () => {
    usarVehiculos({ 45: { ...TC_045, tipo_unidad: "VEHICULO" } });
    const res = await post({ ...BASE, tcVehiculoId: 45 });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("no está clasificado como TC");
    usarVehiculos({ 45: { ...TC_045, tipo_unidad: undefined } });
    expect((await post({ ...BASE, tcVehiculoId: 45 })).status).toBe(400);
  });

  it("un TC en taller o inactivo se rechaza (409)", async () => {
    usarVehiculos({ 45: { ...TC_045, en_taller: 1 } });
    expect((await post({ ...BASE, tcVehiculoId: 45 })).status).toBe(409);
    usarVehiculos({ 45: { ...TC_045, activo: 0 } });
    expect((await post({ ...BASE, tcVehiculoId: 45 })).status).toBe(409);
    expect(insertPlan()).toBeUndefined();
  });

  it("un TC enviado en el campo Unidad (placa) se rechaza: Unidad y TC son recursos distintos", async () => {
    vi.mocked(listarDisponibilidadVehiculos).mockResolvedValue({
      vehiculos: [{ id: 45, placa: "TC-045", tipoUnidad: "TC", puedeEnviar: true, estadoDisponibilidad: "disponible" }],
      resumen: {},
    } as never);
    const res = await post({ ...BASE, placa: "tc-045", pilotoNombre: "Piloto Uno" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("clasificada como TC");
    expect(insertPlan()).toBeUndefined();
  });

  it("una unidad normal (VEHICULO/CABEZAL) sigue funcionando como Unidad, con y sin TC", async () => {
    vi.mocked(listarDisponibilidadVehiculos).mockResolvedValue({
      vehiculos: [{ id: 10, placa: "C-123ABC", tipoUnidad: "CABEZAL", puedeEnviar: true, estadoDisponibilidad: "disponible" }],
      resumen: {},
    } as never);
    const res = await post({ ...BASE, placa: "c-123abc", tcVehiculoId: 45, pilotoNombre: "Piloto Uno" });
    expect(res.status).toBe(200);
    const [, params] = insertPlan()!;
    expect(params[IDX.tcId]).toBe(45);
    expect(params[IDX.tcHist]).toBe("TC-045");
  });

  it("audita el TC asignado", async () => {
    const { registrarAuditoria } = await import("@/lib/auditoria");
    await post({ ...BASE, tcVehiculoId: 45 });
    expect(vi.mocked(registrarAuditoria).mock.calls[0][0].detalle).toContain("TC TC-045");
  });
});

describe("POST — disponibilidad diaria del TC (misma política que Unidad/Piloto/Auxiliar)", () => {
  beforeEach(() => {
    ocupacionesTc = [{ recurso_id: 45, nombre: "TC-045", plan_id: 125, codigo: "PLAN-000125", fecha: "2026-09-23" }];
  });

  it("mismo TC, misma fecha, otro plan (aunque no esté cerrado) -> 409 con el mensaje esperado y sin crear el viaje", async () => {
    const res = await post({ ...BASE, tcVehiculoId: 45 });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("El TC TC-045 ya está asignado al PLAN-000125 para el 23/09/2026.");
    expect(insertPlan()).toBeUndefined();
  });

  it("aunque cambie la hora, el mismo día sigue bloqueado (reserva diaria, no por intervalo)", async () => {
    expect((await post({ ...BASE, horaCarga: "22:30", tcVehiculoId: 45 })).status).toBe(409);
  });

  it("mismo TC, día siguiente -> permitido", async () => {
    const res = await post({ ...BASE, fechaPlan: "2026-09-24", tcVehiculoId: 45 });
    expect(res.status).toBe(200);
    expect(insertPlan()![1][IDX.tcId]).toBe(45);
  });

  it("la consulta va acotada por la empresa de la sesión y por fecha_plan, y usa los estados de asignación diaria (Cerrado incluido, Cancelado no)", async () => {
    await post({ ...BASE, tcVehiculoId: 45 });
    const c = consultaTc()[0];
    expect(c.sql).toContain("p.empresa_id = ?");
    expect(c.sql).toContain("p.fecha_plan = ?");
    expect(c.params.slice(0, 2)).toEqual([7, "2026-09-23"]);
    expect(c.params).toContain("Cerrado");
    expect(c.params).not.toContain("Cancelado");
  });

  it("un viaje sin TC no dispara la consulta de disponibilidad de TC", async () => {
    await post({ ...BASE, pilotoNombre: "Piloto Uno" });
    expect(consultaTc()).toEqual([]);
  });
});

describe("POST — viaje TERCERIZADO: TC externo solo como texto", () => {
  const TERCERIZADO = { ...BASE, tipoViaje: "Tercerizado", pilotoExternoNombre: "Juan Externo", tcExternoPlaca: "tc-778" };

  it("guarda el TC externo como snapshot (mayúsculas) y deja el TC interno en NULL", async () => {
    const res = await post(TERCERIZADO);
    expect(res.status).toBe(200);
    const [, params] = insertPlan()!;
    expect(params[IDX.tcExt]).toBe("TC-778");
    expect(params[IDX.tcId]).toBeNull();
    expect(params[IDX.tcHist]).toBeNull();
  });

  it("NO consulta el catálogo interno de TC ni valida disponibilidad interna", async () => {
    ocupacionesTc = [{ recurso_id: 45, nombre: "TC-045", plan_id: 125, codigo: "PLAN-000125", fecha: "2026-09-23" }];
    const res = await post(TERCERIZADO);
    expect(res.status).toBe(200);
    expect(obtenerVehiculoAccesible).not.toHaveBeenCalled();
    expect(consultaTc()).toEqual([]);
  });

  it("NUNCA crea un vehículo (flota_vehiculos) ni una unidad (tms_unidades) para el TC externo", async () => {
    await post(TERCERIZADO);
    expect(consultas.filter((c) => /INSERT INTO (flota_vehiculos|tms_unidades|tms_personal)/.test(c.sql))).toEqual([]);
  });

  it("un TC INTERNO en un viaje tercerizado se rechaza (nunca sustituye al snapshot externo)", async () => {
    const res = await post({ ...TERCERIZADO, tcVehiculoId: 45 });
    expect(res.status).toBe(400);
    expect(insertPlan()).toBeUndefined();
  });

  it("un TC externo enviado en un viaje PROPIO se ignora (no se guarda como snapshot)", async () => {
    await post({ ...BASE, tcExternoPlaca: "TC-778", pilotoNombre: "Piloto Uno" });
    expect(insertPlan()![1][IDX.tcExt]).toBeNull();
  });

  it("no genera viáticos internos (regresión: recursos vacíos)", async () => {
    await post(TERCERIZADO);
    expect(sincronizarViaticosPlan).toHaveBeenCalledWith(7, expect.any(Number), { piloto: null, auxiliares: [] }, expect.anything(), expect.anything());
  });
});

describe("PATCH — editar el TC de un viaje PROPIO", () => {
  const fila = (over: Record<string, unknown> = {}) => ({
    id: 40, codigo: "PLAN-40", estado: "Programado", fecha_plan: "2026-09-23", hora_carga: "08:00:00", placa: "", piloto: "",
    piloto_id: null, unidad_id: null, regreso_estimado: null, tarifa_comercial: null, costo_operativo_referencia: null,
    referencia_cliente: null, flota_vehiculo_id: null, pendiente_cierre: 0, ruta_id: null, tarifa_id: null, notas: null,
    tipo_viaje: "Propio", tc_vehiculo_id: 45, ...over,
  });
  const usarPlan = (f: Record<string, unknown>) => {
    vi.mocked(query).mockImplementation((async (sql: string, params: unknown[] = []) => {
      consultas.push({ sql: String(sql), params });
      if (String(sql).includes("FROM tms_planes_viaje p") && String(sql).includes("WHERE p.id = ?")) return [f];
      if (String(sql).includes("FROM flota_vehiculos v")) return responderTc(String(sql), params);
      return [];
    }) as never);
  };
  // Parámetros del UPDATE: los 6 últimos antes de (id, empresa, estado).
  const paramsTc = () => {
    const p = updatePlan()![1];
    return p.slice(p.length - 9, p.length - 3);
  };

  it("editar OTROS campos conserva el TC (no reescribe las columnas TC) y el propio plan se autoexcluye de la validación", async () => {
    usarPlan(fila());
    ocupacionesTc = [{ recurso_id: 45, nombre: "TC-045", plan_id: 40, codigo: "PLAN-40", fecha: "2026-09-23" }];
    const res = await patch({ id: 40, notas: "cambio de notas" });
    expect(res.status).toBe(200);
    expect(paramsTc()).toEqual([false, null, false, null, false, null]);
    const validacion = consultas.find((c) => c.sql.includes("FROM flota_vehiculos v") && c.sql.includes("FOR UPDATE"))!;
    expect(validacion.sql).toContain("AND p.id != ?");
    expect(validacion.params[validacion.params.length - 1]).toBe(40);
  });

  it("el mismo TC enviado de nuevo no se re-valida (ni por taller) ni se reescribe", async () => {
    usarPlan(fila());
    usarVehiculos({ 45: { ...TC_045, en_taller: 1 } });
    const res = await patch({ id: 40, tcVehiculoId: 45 });
    expect(res.status).toBe(200);
    expect(obtenerVehiculoAccesible).not.toHaveBeenCalled();
    expect(paramsTc().slice(0, 4)).toEqual([false, null, false, null]);
  });

  it("cambiar de TC valida el nuevo (acceso + clasificación) y reescribe id + fotografía", async () => {
    usarPlan(fila());
    usarVehiculos({ 46: { ...TC_045, id: 46, placa: "TC-046" } });
    const res = await patch({ id: 40, tcVehiculoId: 46 });
    expect(res.status).toBe(200);
    expect(obtenerVehiculoAccesible).toHaveBeenCalledWith(7, 46, expect.stringContaining("tipo_unidad"));
    expect(paramsTc().slice(0, 4)).toEqual([true, 46, true, "TC-046"]);
  });

  it("cambiar a un TC ya asignado ese día a OTRO plan -> 409 (backend, no solo UI)", async () => {
    usarPlan(fila());
    usarVehiculos({ 46: { ...TC_045, id: 46, placa: "TC-046" } });
    ocupacionesTc = [{ recurso_id: 46, nombre: "TC-046", plan_id: 99, codigo: "PLAN-000099", fecha: "2026-09-23" }];
    const res = await patch({ id: 40, tcVehiculoId: 46 });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("El TC TC-046 ya está asignado al PLAN-000099 para el 23/09/2026.");
    expect(updatePlan()).toBeUndefined();
  });

  it("cambiar la fecha del plan revalida el TC contra la NUEVA fecha", async () => {
    usarPlan(fila());
    ocupacionesTc = [{ recurso_id: 45, nombre: "TC-045", plan_id: 99, codigo: "PLAN-000099", fecha: "2026-09-25" }];
    const res = await patch({ id: 40, fechaPlan: "2026-09-25" });
    expect(res.status).toBe(409);
  });

  it("tcVehiculoId: null quita el TC", async () => {
    usarPlan(fila());
    const res = await patch({ id: 40, tcVehiculoId: null });
    expect(res.status).toBe(200);
    expect(paramsTc().slice(0, 4)).toEqual([true, null, true, null]);
  });

  it("un TC inexistente / de otra empresa en PATCH -> 400", async () => {
    usarPlan(fila({ tc_vehiculo_id: null }));
    usarVehiculos({});
    expect((await patch({ id: 40, tcVehiculoId: 77 })).status).toBe(400);
  });

  it("un plan de OTRA empresa nunca se edita (404), sin tocar TC", async () => {
    vi.mocked(query).mockResolvedValue([] as never);
    expect((await patch({ id: 999, tcVehiculoId: 45 })).status).toBe(404);
    expect(obtenerVehiculoAccesible).not.toHaveBeenCalled();
  });
});

describe("PATCH — TC de un viaje TERCERIZADO y cambio de tipo", () => {
  const filaT = (over: Record<string, unknown> = {}) => ({
    id: 41, codigo: "PLAN-41", estado: "Programado", fecha_plan: "2026-09-23", hora_carga: "08:00:00", placa: "", piloto: "",
    piloto_id: null, unidad_id: null, regreso_estimado: null, tarifa_comercial: null, costo_operativo_referencia: null,
    referencia_cliente: null, flota_vehiculo_id: null, pendiente_cierre: 0, ruta_id: null, tarifa_id: null, notas: null,
    tipo_viaje: "Tercerizado", tc_vehiculo_id: null, ...over,
  });
  const usarPlan = (f: Record<string, unknown>) => {
    vi.mocked(query).mockImplementation((async (sql: string, params: unknown[] = []) => {
      consultas.push({ sql: String(sql), params });
      if (String(sql).includes("SELECT id, codigo, estado, tipo_viaje FROM tms_planes_viaje")) return [f];
      if (String(sql).includes("FROM tms_planes_viaje p") && String(sql).includes("WHERE p.id = ?")) return [f];
      return [];
    }) as never);
  };

  it("edición conserva/actualiza el snapshot externo (tcExternoPlaca en mayúsculas) sin tocar el catálogo interno", async () => {
    usarPlan(filaT());
    const res = await patch({ id: 41, tcExternoPlaca: "tc-778" });
    expect(res.status).toBe(200);
    const p = updatePlan()![1];
    expect(p.slice(p.length - 5, p.length - 3)).toEqual([true, "TC-778"]);
    expect(obtenerVehiculoAccesible).not.toHaveBeenCalled();
    expect(consultaTc()).toEqual([]);
  });

  it("un TC interno en un plan tercerizado se rechaza (400)", async () => {
    usarPlan(filaT());
    expect((await patch({ id: 41, tcVehiculoId: 45 })).status).toBe(400);
  });

  it("Propio -> Tercerizado: libera el TC interno (id/fotografía en NULL) y guarda el snapshot externo", async () => {
    usarPlan(filaT({ tipo_viaje: "Propio", tc_vehiculo_id: 45 }));
    const res = await patch({ id: 41, tipoViaje: "Tercerizado", pilotoExternoNombre: "Juan Externo", tcExternoPlaca: "tc-778" });
    expect(res.status).toBe(200);
    const [sql, params] = updatePlan()!;
    expect(sql).toContain("tc_vehiculo_id = NULL, tc_placa_historica = NULL, tc_externo_placa = ?");
    expect(params).toContain("TC-778");
  });

  it("Propio -> Tercerizado con un TC interno en el mismo PATCH se rechaza (no se mezclan)", async () => {
    usarPlan(filaT({ tipo_viaje: "Propio", tc_vehiculo_id: 45 }));
    expect((await patch({ id: 41, tipoViaje: "Tercerizado", pilotoExternoNombre: "X", tcVehiculoId: 45 })).status).toBe(400);
  });

  it("Tercerizado -> Propio: limpia el snapshot externo (el TC interno lo asigna el PATCH normal posterior)", async () => {
    usarPlan(filaT());
    const res = await patch({ id: 41, tipoViaje: "Propio" });
    expect(res.status).toBe(200);
    expect(updatePlan()![0]).toContain("tc_externo_placa = NULL");
  });
});
