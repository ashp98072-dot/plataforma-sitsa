import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * PROGRAMACIÓN — EDICIÓN RÁPIDA, PR-0: pruebas de EQUIVALENCIA de PATCH /tms/planes.
 *
 * Caracterizan el comportamiento del PATCH (mensajes, códigos HTTP, orden de operaciones, lock, política de
 * disponibilidad) para que la extracción de validaciones a `programacion-validacion-recursos.ts` no lo cambie.
 * Las fechas son RELATIVAS a hoyLocal() (sin fechas fijas que caduquen).
 */
vi.mock("@/lib/db", () => ({ execute: vi.fn(), getPool: vi.fn(), query: vi.fn() }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoria: vi.fn(), registrarAuditoriaTx: vi.fn() }));
vi.mock("@/lib/tenant", () => ({ requireTenantProgramacion: vi.fn(), requireTenantProgramacionOTms: vi.fn() }));
vi.mock("@/lib/flota/schema", () => ({ asegurarSchemaFlota: vi.fn(() => Promise.resolve()) }));
vi.mock("@/lib/operaciones/disponibilidad", () => ({ listarDisponibilidadVehiculos: vi.fn(), placasDisponiblesParaPlan: vi.fn(() => []) }));
vi.mock("@/lib/operaciones/disponibilidad-personal", () => ({ listarDisponibilidadPersonal: vi.fn() }));
vi.mock("@/lib/tms/codigo-plan", () => ({ asegurarCodigoPlanUnico: vi.fn(), generarCodigoPlan: vi.fn() }));
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
vi.mock("@/lib/tms/plan-comunes", () => ({ upsertLugar: vi.fn(), guardarAuxiliaresPlan: vi.fn(() => Promise.resolve()) }));
vi.mock("@/lib/tms/personal-resolucion", () => ({ personalDesdeEmpleado: vi.fn(), validarPersonalId: vi.fn() }));
vi.mock("@/lib/tms/tc-plan", () => ({ resolverTcInterno: vi.fn() }));
vi.mock("@/lib/tms/disponibilidad-programacion-intervalos", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tms/disponibilidad-programacion-intervalos")>();
  return { ...actual, primerConflictoProgramacionIntervalo: vi.fn(() => Promise.resolve(null)) };
});

import { execute, getPool, query } from "@/lib/db";
import { registrarAuditoria } from "@/lib/auditoria";
import { requireTenantProgramacion } from "@/lib/tenant";
import { listarDisponibilidadVehiculos } from "@/lib/operaciones/disponibilidad";
import { listarDisponibilidadPersonal } from "@/lib/operaciones/disponibilidad-personal";
import { obtenerVehiculoAccesible } from "@/lib/flota/acceso";
import { guardarParadasPlan } from "@/lib/tms/paradas";
import { guardarAuxiliaresPlan } from "@/lib/tms/plan-comunes";
import { personalDesdeEmpleado, validarPersonalId } from "@/lib/tms/personal-resolucion";
import { resolverTcInterno } from "@/lib/tms/tc-plan";
import { sincronizarViaticosPlan } from "@/lib/tms/viaticos";
import { primerConflictoProgramacionIntervalo } from "@/lib/tms/disponibilidad-programacion-intervalos";
import { hoyLocal } from "@/lib/rrhh/dates";
import { PATCH } from "./route";

const ctx = { params: Promise.resolve({ slug: "kt-monaco" }) };
const patch = (body: unknown) => PATCH(new Request("http://x/api", { method: "PATCH", body: JSON.stringify(body) }), ctx);
const sumarDias = (fecha: string, n: number) => { const d = new Date(`${fecha}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const HOY = hoyLocal();
const MANANA = sumarDias(HOY, 1);
const AYER = sumarDias(HOY, -1);

let orden: string[];
let conexion: ReturnType<typeof crearConexion>;
let filaPlan: Record<string, unknown>;
let auxiliaresActuales: Record<string, unknown>[];
let viaticosNoProgramados: Record<string, unknown>[];

const plan = (over: Record<string, unknown> = {}) => ({
  id: 40, codigo: "PLAN-40", estado: "Programado", fecha_plan: MANANA, hora_carga: "08:00:00", placa: "C-100", piloto: "Piloto Actual",
  piloto_id: 10, unidad_id: 3, regreso_estimado: null, tarifa_comercial: null, costo_operativo_referencia: null, referencia_cliente: null,
  flota_vehiculo_id: 55, pendiente_cierre: 0, ruta_id: null, tarifa_id: null, notas: null, tipo_viaje: "Propio", tc_vehiculo_id: null, ...over,
});

function crearConexion() {
  return {
    beginTransaction: vi.fn(async () => { orden.push("begin"); }),
    commit: vi.fn(async () => { orden.push("commit"); }),
    rollback: vi.fn(async () => { orden.push("rollback"); }),
    release: vi.fn(),
    query: vi.fn(async (sql: string) => {
      if (String(sql).includes("GET_LOCK")) { orden.push("lock"); return [[{ l: 1 }]]; }
      if (String(sql).includes("RELEASE_LOCK")) { orden.push("unlock"); return [[{ l: 1 }]]; }
      return [[]];
    }),
    execute: vi.fn(async (sql: string) => { if (String(sql).includes("UPDATE tms_planes_viaje")) orden.push("update"); return [{ insertId: 91, affectedRows: 1 }]; }),
  };
}

const personalDisp = (over: Record<string, unknown> = {}) => ({
  personalId: 20, nombre: "Piloto Nuevo", incidenciasBloqueantes: [], viajeActual: null, estadoDisponibilidad: "disponible",
  otrosPlanesDelDia: [], advertencias: [], ...over,
});
const vehiculo = (over: Record<string, unknown> = {}) => ({ id: 77, placa: "C-777", tipoUnidad: "Camion", estadoDisponibilidad: "disponible", viajeAbierto: null, ...over });
const usarPersonal = (...filas: Record<string, unknown>[]) => vi.mocked(listarDisponibilidadPersonal).mockResolvedValue(filas as never);
const usarVehiculos = (...filas: Record<string, unknown>[]) => vi.mocked(listarDisponibilidadVehiculos).mockResolvedValue({ vehiculos: filas, resumen: {} } as never);
const update = () => conexion.execute.mock.calls.find((c) => String(c[0]).includes("UPDATE tms_planes_viaje")) as unknown as [string, unknown[]] | undefined;
const cambiarPiloto = (extra: Record<string, unknown> = {}) => ({ id: 40, pilotoPersonalId: 20, motivoCambio: "Piloto no se presentó", ...extra });

beforeEach(() => {
  vi.resetAllMocks();
  orden = [];
  filaPlan = plan();
  auxiliaresActuales = [];
  viaticosNoProgramados = [];
  conexion = crearConexion();
  vi.mocked(requireTenantProgramacion).mockResolvedValue({ error: null, empresa: { id: 7, nombre: "KT" }, session: { username: "ops", id: 3, rol: "Operaciones" } } as never);
  vi.mocked(getPool).mockReturnValue({ getConnection: vi.fn().mockResolvedValue(conexion) } as never);
  vi.mocked(query).mockImplementation((async (sql: string) => {
    const s = String(sql);
    if (s.includes("FROM tms_planes_viaje p") && s.includes("WHERE p.id = ?") && s.includes("p.hora_carga")) return [filaPlan];
    if (s.includes("FROM tms_plan_auxiliares a")) return auxiliaresActuales;
    if (s.includes("FROM tms_viaticos")) return viaticosNoProgramados;
    if (s.includes("SELECT p.fecha_plan, u.placa, pil.nombre")) return [{ fecha_plan: filaPlan.fecha_plan, placa: "C-100", piloto: "Piloto Actual" }];
    return [];
  }) as never);
  vi.mocked(execute).mockResolvedValue({ insertId: 500, affectedRows: 1 } as never);
  vi.mocked(registrarAuditoria).mockImplementation((async () => { orden.push("auditoria"); }) as never);
  vi.mocked(primerConflictoProgramacionIntervalo).mockImplementation((async () => { orden.push("conflicto"); return null; }) as never);
  vi.mocked(guardarAuxiliaresPlan).mockImplementation((async () => { orden.push("auxiliares"); }) as never);
  vi.mocked(sincronizarViaticosPlan).mockImplementation((async () => { orden.push("viaticos"); }) as never);
  vi.mocked(validarPersonalId).mockImplementation((async (_e: number, id: number) => ({ id, nombre: id === 20 ? "Piloto Nuevo" : `Persona ${id}` })) as never);
  usarPersonal(personalDisp());
  usarVehiculos(vehiculo());
});

describe("PATCH — estados y fecha (reglas por estado)", () => {
  it.each(["Cerrado", "Cancelado"])("1/2) %s -> 409 y no abre transacción", async (estado) => {
    filaPlan = plan({ estado });
    const res = await patch({ id: 40, notas: "x" });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe(`Este plan está en estado "${estado}" y ya no admite modificaciones desde Programación.`);
    expect(getPool).not.toHaveBeenCalled();
  });

  it("3) fecha pasada: la regla actual responde 400 (no se puede reprogramar/editar un viaje de una fecha anterior a hoy)", async () => {
    filaPlan = plan({ fecha_plan: AYER });
    const res = await patch({ id: 40, notas: "x" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("No se puede reprogramar un viaje hacia una fecha pasada.");
    expect(getPool).not.toHaveBeenCalled();
  });

  it("3b) reprogramar hacia una fecha pasada también se rechaza; hoy y mañana son editables", async () => {
    expect((await patch({ id: 40, fechaPlan: AYER })).status).toBe(400);
    expect((await patch({ id: 40, notas: "hoy" })).status).toBe(200);
    filaPlan = plan({ fecha_plan: HOY });
    expect((await patch({ id: 40, notas: "hoy" })).status).toBe(200);
  });

  it.each(["Programado", "Cargado", "Descargado"])("4/5/6) %s admite edición operativa completa", async (estado) => {
    filaPlan = plan({ estado });
    const res = await patch(cambiarPiloto());
    expect(res.status).toBe(200);
    expect(update()).toBeDefined();
    expect(orden).toEqual(["begin", "lock", "conflicto", "update", "viaticos", "commit", "unlock", "auditoria"]);
  });

  it("7) En ruta SIN llegada: solo notas; piloto/unidad/auxiliares/fecha/hora/paradas/comercial -> 409 con el mismo texto", async () => {
    filaPlan = plan({ estado: "En ruta", pendiente_cierre: 0 });
    expect((await patch({ id: 40, notas: "solo notas" })).status).toBe(200);
    const res = await patch({ id: 40, pilotoPersonalId: 20, motivoCambio: "x", fechaPlan: MANANA, horaCarga: "09:00", tarifaComercial: 10 });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe(
      'El plan está "En ruta"; solo se pueden editar notas mientras está en ruta (no permitido: piloto, fecha, hora de carga, datos comerciales/regreso estimado).',
    );
  });

  it("8) En ruta CON llegada (pendiente de cierre): permite piloto/unidad/auxiliares con advertencia; fecha y hora siguen bloqueadas", async () => {
    filaPlan = plan({ estado: "En ruta", pendiente_cierre: 1 });
    const ok = await patch(cambiarPiloto());
    expect(ok.status).toBe(200);
    expect((await ok.json()).advertencias).toEqual([expect.objectContaining({ tipo: "reasignacion_pre_cierre" })]);
    expect(registrarAuditoria).toHaveBeenLastCalledWith(expect.objectContaining({ accion: "corregir_pre_cierre" }));
    const bloqueado = await patch({ id: 40, fechaPlan: MANANA, horaCarga: "09:00" });
    expect(bloqueado.status).toBe(409);
    expect((await bloqueado.json()).error).toContain('El plan está "En ruta" (pendiente de cierre); no se puede modificar: fecha, hora de carga.');
  });
});

describe("PATCH — motivo de cambio", () => {
  it("16) piloto, unidad o auxiliares SIN motivoCambio -> 400 antes de cualquier escritura", async () => {
    for (const cuerpo of [{ id: 40, pilotoPersonalId: 20 }, { id: 40, flotaVehiculoId: 77 }, { id: 40, auxiliarPersonalIds: [7] }, { id: 40, pilotoPersonalId: 20, motivoCambio: "   " }]) {
      const res = await patch(cuerpo);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("Indica el motivo del cambio de piloto, unidad o auxiliares.");
    }
    expect(getPool).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it("notas / datos no sensibles no exigen motivo", async () => {
    expect((await patch({ id: 40, notas: "ok" })).status).toBe(200);
  });
});

describe("PATCH — tercerizado y TC", () => {
  it("9) un viaje Tercerizado rechaza un TC interno (usa solo el TC externo como texto)", async () => {
    filaPlan = plan({ tipo_viaje: "Tercerizado", piloto_id: null, unidad_id: null, flota_vehiculo_id: null, placa: null, piloto: null });
    const res = await patch({ id: 40, tcVehiculoId: 9 });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Un viaje tercerizado no usa TC interno: captura el TC externo como texto.");
    expect(resolverTcInterno).not.toHaveBeenCalled();
  });

  it("9b) Tercerizado sin recursos internos: no consulta disponibilidad de personal/unidad ni valida traslapes", async () => {
    filaPlan = plan({ tipo_viaje: "Tercerizado", piloto_id: null, unidad_id: null, flota_vehiculo_id: null, placa: null, piloto: null });
    expect((await patch({ id: 40, notas: "externo", tcExternoPlaca: "tc-ext" })).status).toBe(200);
    expect(listarDisponibilidadPersonal).not.toHaveBeenCalled();
    expect(primerConflictoProgramacionIntervalo).not.toHaveBeenCalled();
    expect(orden).not.toContain("lock");
    expect(update()![1]).toContain("TC-EXT"); // placa externa en mayúsculas
  });

  it("14) TC inválido (acceso/clasificación/inactivo) -> el status y mensaje del validador, sin abrir transacción", async () => {
    vi.mocked(resolverTcInterno).mockResolvedValue({ ok: false, status: 400, error: "La placa no está clasificada como TC." } as never);
    const res = await patch({ id: 40, tcVehiculoId: 9 });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("La placa no está clasificada como TC.");
    expect(getPool).not.toHaveBeenCalled();
  });

  it("TC válido distinto: se valida, se escribe (id + fotografía de placa) y participa en la política diaria", async () => {
    vi.mocked(resolverTcInterno).mockResolvedValue({ ok: true, vehiculoId: 9, placa: "TC-9" } as never);
    expect((await patch({ id: 40, tcVehiculoId: 9 })).status).toBe(200);
    expect(vi.mocked(primerConflictoProgramacionIntervalo).mock.calls[0][1]).toContainEqual({ tipo: "tc", id: 9 });
    expect(update()![1]).toEqual(expect.arrayContaining([true, 9, "TC-9"]));
  });

  it("el MISMO TC enviado de nuevo no se re-valida ni se reescribe", async () => {
    filaPlan = plan({ tc_vehiculo_id: 9 });
    expect((await patch({ id: 40, tcVehiculoId: 9, notas: "x" })).status).toBe(200);
    expect(resolverTcInterno).not.toHaveBeenCalled();
  });
});

describe("PATCH — disponibilidad de personal", () => {
  it("10) personal inactivo / de baja -> 409", async () => {
    usarPersonal(personalDisp({ estadoDisponibilidad: "no_disponible" }));
    const res = await patch(cambiarPiloto());
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("El piloto seleccionado no está activo o el empleado vinculado está de baja.");
    expect(getPool).not.toHaveBeenCalled();
  });

  it("15) incidencia bloqueante -> 409 con tipo y rango de fechas", async () => {
    usarPersonal(personalDisp({ incidenciasBloqueantes: [{ tipo: "Vacaciones", fechaInicio: MANANA, fechaFin: MANANA }] }));
    const res = await patch(cambiarPiloto());
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe(`El piloto seleccionado tiene una incidencia (Vacaciones) del ${MANANA} al ${MANANA} que cubre el ${MANANA}.`);
  });

  it("viaje en curso: hoy -> 409; otro día -> solo advertencia", async () => {
    usarPersonal(personalDisp({ viajeActual: { planId: 1 } }));
    filaPlan = plan({ fecha_plan: HOY });
    const hoy = await patch(cambiarPiloto());
    expect(hoy.status).toBe(409);
    expect((await hoy.json()).error).toBe("El piloto seleccionado tiene un viaje en curso.");
    filaPlan = plan({ fecha_plan: MANANA });
    const manana = await patch(cambiarPiloto());
    expect(manana.status).toBe(200);
    expect((await manana.json()).advertencias).toEqual([expect.objectContaining({ tipo: "viaje_actual_piloto" })]);
  });

  it("otro plan el mismo día e incidencia informativa son solo advertencias (nunca bloquean)", async () => {
    usarPersonal(personalDisp({
      otrosPlanesDelDia: [{ planId: 41, planCodigo: "PLAN-41" }, { planId: 40, planCodigo: "PLAN-40" }],
      advertencias: [{ tipo: "incidencia_informativa", incidencia: { tipo: "Permiso" } }],
    }));
    const res = await patch(cambiarPiloto());
    expect(res.status).toBe(200);
    expect((await res.json()).advertencias.map((a: { tipo: string }) => a.tipo)).toEqual(["otro_plan_dia_piloto", "incidencia_informativa_piloto"]);
  });

  it("piloto/auxiliar inexistente o de otra empresa -> 400", async () => {
    vi.mocked(validarPersonalId).mockResolvedValue(null);
    const p = await patch(cambiarPiloto());
    expect(p.status).toBe(400);
    expect((await p.json()).error).toBe("El piloto seleccionado no existe o no pertenece a esta empresa.");
    const a = await patch({ id: 40, auxiliarPersonalIds: [7], motivoCambio: "x" });
    expect(a.status).toBe(400);
    expect((await a.json()).error).toBe("Un auxiliar seleccionado no existe o no pertenece a esta empresa (id 7).");
  });
});

describe("PATCH — disponibilidad de unidad", () => {
  beforeEach(() => vi.mocked(obtenerVehiculoAccesible).mockResolvedValue({ placa: "c-777" } as never));
  const cambiarUnidad = () => ({ id: 40, flotaVehiculoId: 77, motivoCambio: "Unidad no disponible" });

  it("11) unidad inactiva -> 409", async () => {
    usarVehiculos(vehiculo({ estadoDisponibilidad: "inactivo" }));
    const res = await patch(cambiarUnidad());
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("La unidad seleccionada está inactiva.");
  });

  it("12) unidad en taller: hoy 409; otro día advertencia", async () => {
    usarVehiculos(vehiculo({ estadoDisponibilidad: "en_taller" }));
    filaPlan = plan({ fecha_plan: HOY });
    const hoy = await patch(cambiarUnidad());
    expect(hoy.status).toBe(409);
    expect((await hoy.json()).error).toBe("La unidad seleccionada está actualmente en taller.");
    filaPlan = plan({ fecha_plan: MANANA });
    const manana = await patch(cambiarUnidad());
    expect(manana.status).toBe(200);
    expect((await manana.json()).advertencias).toEqual([expect.objectContaining({ tipo: "vehiculo_en_taller" })]);
  });

  it("13) unidad en ruta: hoy 409 (con el piloto del viaje abierto); otro día advertencia", async () => {
    usarVehiculos(vehiculo({ estadoDisponibilidad: "en_ruta", viajeAbierto: { pilotoNombre: "Ana" } }));
    filaPlan = plan({ fecha_plan: HOY });
    const hoy = await patch(cambiarUnidad());
    expect(hoy.status).toBe(409);
    expect((await hoy.json()).error).toBe("La unidad seleccionada está actualmente en ruta con Ana.");
    filaPlan = plan({ fecha_plan: MANANA });
    const manana = await patch(cambiarUnidad());
    expect(manana.status).toBe(200);
    expect((await manana.json()).advertencias).toEqual([expect.objectContaining({ tipo: "vehiculo_en_ruta" })]);
  });

  it("una placa clasificada como TC no puede asignarse como Unidad (400)", async () => {
    usarVehiculos(vehiculo({ tipoUnidad: "TC" }));
    const res = await patch(cambiarUnidad());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("La placa C-777 está clasificada como TC: asígnala en el campo TC, no como Unidad.");
  });

  it("unidad inaccesible para la empresa -> 400", async () => {
    vi.mocked(obtenerVehiculoAccesible).mockResolvedValue(null);
    const res = await patch(cambiarUnidad());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("La unidad seleccionada no existe o no es accesible para esta empresa.");
  });
});

describe("PATCH — quitar personal con viático ya procesado", () => {
  it("17) piloto con viático AUTORIZADO/ENTREGADO/LIQUIDADO no se puede quitar -> 409 antes de escribir", async () => {
    viaticosNoProgramados = [{ personal_id: 10, estado: "AUTORIZADO" }];
    const res = await patch(cambiarPiloto());
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("No se puede quitar a Piloto Actual del viaje porque su viático ya fue autorizado.");
    expect(getPool).not.toHaveBeenCalled();
  });

  it("varios bloqueados -> mensaje agregado", async () => {
    auxiliaresActuales = [{ plan_id: 40, personal_id: 5, id_empleado: null, nombre: "Aux Cinco", telefono: null }];
    viaticosNoProgramados = [{ personal_id: 10, estado: "ENTREGADO" }, { personal_id: 5, estado: "LIQUIDADO" }];
    const res = await patch({ id: 40, pilotoPersonalId: 20, auxiliarPersonalIds: [], motivoCambio: "x" });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe(
      "No se puede modificar el personal del viaje: Piloto Actual (viático entregado), Aux Cinco (viático liquidado) — su(s) viático(s) ya fue(ron) procesado(s).",
    );
  });

  it("solo consulta viáticos de quienes SALEN del viaje (no del piloto que se queda)", async () => {
    expect((await patch({ id: 40, pilotoPersonalId: 10, auxiliarPersonalIds: [7], motivoCambio: "x" })).status).toBe(200);
    expect(vi.mocked(query).mock.calls.filter(([sql]) => String(sql).includes("FROM tms_viaticos"))).toHaveLength(0);
  });
});

describe("PATCH — auxiliares (principal y adicionales) y política por intervalos/lock", () => {
  it("18) auxiliarPersonalIds: el primero es el principal (auxiliar_id), todos van a tms_plan_auxiliares y a la sincronización de viáticos", async () => {
    usarPersonal(personalDisp({ personalId: 7, nombre: "Aux Siete" }), personalDisp({ personalId: 9, nombre: "Aux Nueve" }));
    const res = await patch({ id: 40, auxiliarPersonalIds: [7, 9, 7], motivoCambio: "Reorganización" });
    expect(res.status).toBe(200);
    expect(guardarAuxiliaresPlan).toHaveBeenCalledWith(40, [7, 9], conexion);
    expect(update()![1][2]).toBe(7); // auxiliar_id = principal
    expect(sincronizarViaticosPlan).toHaveBeenCalledWith(7, 40, { piloto: 10, auxiliares: [7, 9] }, conexion);
  });

  it("18b) auxiliarPersonalIds: [] quita a todos (auxiliar_id NULL) y también sincroniza", async () => {
    auxiliaresActuales = [{ plan_id: 40, personal_id: 5, id_empleado: null, nombre: "Aux Cinco", telefono: null }];
    expect((await patch({ id: 40, auxiliarPersonalIds: [], motivoCambio: "x" })).status).toBe(200);
    expect(guardarAuxiliaresPlan).toHaveBeenCalledWith(40, [], conexion);
    expect(update()![1][2]).toBeNull();
  });

  it("A2.1 política por intervalos: recursos efectivos (piloto, auxiliares, unidad, TC) vs la ventana efectiva excluyendo el propio plan, con la misma conexión", async () => {
    auxiliaresActuales = [{ plan_id: 40, personal_id: 5, id_empleado: null, nombre: "Aux Cinco", telefono: null }];
    filaPlan = plan({ tc_vehiculo_id: 9 });
    await patch({ id: 40, notas: "x", fechaPlan: sumarDias(MANANA, 1) });
    expect(primerConflictoProgramacionIntervalo).toHaveBeenCalledWith(
      7,
      [{ tipo: "piloto", id: 10 }, { tipo: "auxiliar", id: 5 }, { tipo: "unidad", id: 3 }, { tipo: "tc", id: 9 }],
      { fechaPlan: sumarDias(MANANA, 1), horaCarga: "08:00:00", regresoEstimado: null }, // hora guardada; sin regreso => reserva diaria en el motor
      [40],
      conexion,
    );
  });

  it("un conflicto bajo el candado revierte TODO (rollback, sin UPDATE) y libera el lock", async () => {
    vi.mocked(primerConflictoProgramacionIntervalo).mockResolvedValue({ tipo: "piloto", id: 20, nombre: "Piloto Nuevo", planIdConflicto: 41, codigoConflicto: "PLAN-41", inicioConflicto: `${MANANA} 00:00:00`, finConflicto: `${sumarDias(MANANA, 1)} 00:00:00` } as never);
    const res = await patch(cambiarPiloto());
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe(`El piloto Piloto Nuevo ya está asignado al PLAN-41 para el ${MANANA.split("-").reverse().join("/")}.`);
    expect(update()).toBeUndefined();
    expect(conexion.rollback).toHaveBeenCalled();
    expect(orden).toContain("unlock");
  });

  it("si el lock no se obtiene: 409 'otra operación en curso' y rollback", async () => {
    conexion.query.mockImplementation((async (sql: string) => (String(sql).includes("GET_LOCK") ? [[{ l: 0 }]] : [[]])) as never);
    const res = await patch({ id: 40, notas: "x" });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("No se pudo validar la disponibilidad de recursos porque hay otra operación en curso. Intenta de nuevo.");
    expect(update()).toBeUndefined();
  });

  it("el UPDATE es condicional por estado (guardia contra cambios concurrentes de estado)", async () => {
    await patch({ id: 40, notas: "x" });
    expect(update()![0]).toContain("WHERE id = ? AND empresa_id = ? AND estado = ?");
    const p = update()![1];
    expect(p.slice(-3)).toEqual([40, 7, "Programado"]);
  });

  it("Cancelado por PATCH no valida traslapes (libera recursos)", async () => {
    expect((await patch({ id: 40, estado: "Cancelado", notas: "cancelado" })).status).toBe(200);
    expect(primerConflictoProgramacionIntervalo).not.toHaveBeenCalled();
    expect(registrarAuditoria).toHaveBeenLastCalledWith(expect.objectContaining({ accion: "cancelar_ruta" }));
  });
});

describe("PATCH — auditoría y efectos secundarios", () => {
  it("auditoría después del commit, con 'Plan #id código · cambios; motivo'", async () => {
    await patch(cambiarPiloto());
    expect(orden.indexOf("commit")).toBeLessThan(orden.indexOf("auditoria"));
    expect(registrarAuditoria).toHaveBeenCalledWith({
      empresaId: 7, usuario: "ops", accion: "editar_ruta", modulo: "tms",
      detalle: expect.stringMatching(/^Plan #40 PLAN-40 · .*motivo: Piloto no se presentó$/),
    });
  });

  it("20) sin cambios ({id} solo): no crea personal, no toca auxiliares/viáticos/paradas y la bitácora dice 'sin cambios detectados'", async () => {
    const res = await patch({ id: 40 });
    expect(res.status).toBe(200);
    expect(execute).not.toHaveBeenCalled(); // pool global: sin INSERT/UPDATE fuera de la transacción
    expect(personalDesdeEmpleado).not.toHaveBeenCalled();
    expect(validarPersonalId).not.toHaveBeenCalled();
    expect(guardarAuxiliaresPlan).not.toHaveBeenCalled();
    expect(sincronizarViaticosPlan).not.toHaveBeenCalled();
    expect(guardarParadasPlan).not.toHaveBeenCalled();
    expect(registrarAuditoria).toHaveBeenCalledWith(expect.objectContaining({ detalle: "Plan #40 PLAN-40 · sin cambios detectados" }));
  });

  it("plan inexistente o de otra empresa -> 404 (consulta acotada por empresa_id)", async () => {
    vi.mocked(query).mockResolvedValue([] as never);
    const res = await patch({ id: 999, notas: "x" });
    expect(res.status).toBe(404);
    expect(vi.mocked(query).mock.calls[0][1]).toEqual([999, 7]);
  });

  it("piloto por ID que no cambia: no crea personal (validarPersonalId es solo lectura) y sí sincroniza como siempre", async () => {
    usarPersonal(personalDisp({ personalId: 10, nombre: "Piloto Actual" }));
    expect((await patch({ id: 40, pilotoPersonalId: 10, motivoCambio: "x" })).status).toBe(200);
    expect(execute).not.toHaveBeenCalled();
    expect(personalDesdeEmpleado).not.toHaveBeenCalled();
  });
});
