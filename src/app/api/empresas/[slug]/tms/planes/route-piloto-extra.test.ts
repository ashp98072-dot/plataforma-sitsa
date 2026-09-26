import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * PROGRAMACIÓN — PILOTO EXTRA (máximo 1 por viaje Propio) en POST/PATCH /tms/planes: identidad real de RRHH, duplicados, disponibilidad
 * con el MISMO motor que el principal, motivo obligatorio, viáticos propios, protección de viáticos procesados, Tercerizado y tenant.
 * Se ejercita el handler REAL; solo se sustituyen sus dependencias de I/O (mismo patrón que route-patch-equivalencia.test.ts).
 */
vi.mock("@/lib/db", () => ({ execute: vi.fn(), getPool: vi.fn(), query: vi.fn() }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoria: vi.fn(), registrarAuditoriaTx: vi.fn() }));
vi.mock("@/lib/tenant", () => ({ requireTenantProgramacion: vi.fn(), requireTenantProgramacionOTms: vi.fn() }));
vi.mock("@/lib/flota/schema", () => ({ asegurarSchemaFlota: vi.fn(() => Promise.resolve()) }));
vi.mock("@/lib/operaciones/disponibilidad", () => ({ listarDisponibilidadVehiculos: vi.fn(() => Promise.resolve({ vehiculos: [], resumen: {} })), placasDisponiblesParaPlan: vi.fn(() => []) }));
vi.mock("@/lib/operaciones/disponibilidad-personal", () => ({ listarDisponibilidadPersonal: vi.fn(() => Promise.resolve([])) }));
vi.mock("@/lib/tms/codigo-plan", () => ({ asegurarCodigoPlanUnico: vi.fn(() => Promise.resolve("PLAN-20990101-001")), generarCodigoPlan: vi.fn() }));
vi.mock("@/lib/tms/paradas", () => ({ guardarParadasPlan: vi.fn(() => Promise.resolve({ ok: true })), listarParadasDePlanes: vi.fn(() => Promise.resolve(new Map())) }));
vi.mock("@/lib/flota/acceso", () => ({ obtenerVehiculoAccesible: vi.fn() }));
vi.mock("@/lib/flota/pilotos", () => ({ vehiculoPorPlaca: vi.fn() }));
vi.mock("@/lib/tms/viaticos", () => ({
  listarViaticosRechazadosDelPlan: vi.fn(() => Promise.resolve([])),
  personalRecienAsignadoDelPlan: vi.fn(() => []),
  sincronizarViaticosPlan: vi.fn(() => Promise.resolve()),
}));
vi.mock("@/lib/tms/plan-comunes", () => ({ upsertLugar: vi.fn(() => Promise.resolve(1)), guardarAuxiliaresPlan: vi.fn(() => Promise.resolve()) }));
vi.mock("@/lib/tms/personal-resolucion", () => ({ personalDesdeEmpleado: vi.fn(), validarPersonalId: vi.fn() }));
vi.mock("@/lib/tms/tc-plan", () => ({ resolverTcInterno: vi.fn() }));
vi.mock("@/lib/tms/disponibilidad-programacion-intervalos", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tms/disponibilidad-programacion-intervalos")>();
  return { ...actual, primerConflictoProgramacionIntervalo: vi.fn(() => Promise.resolve(null)) };
});

import { execute, getPool, query } from "@/lib/db";
import { requireTenantProgramacion } from "@/lib/tenant";
import { listarDisponibilidadPersonal } from "@/lib/operaciones/disponibilidad-personal";
import { guardarAuxiliaresPlan } from "@/lib/tms/plan-comunes";
import { personalDesdeEmpleado, validarPersonalId } from "@/lib/tms/personal-resolucion";
import { sincronizarViaticosPlan } from "@/lib/tms/viaticos";
import { primerConflictoProgramacionIntervalo } from "@/lib/tms/disponibilidad-programacion-intervalos";
import { hoyLocal } from "@/lib/rrhh/dates";
import { MSG_EXTRA_INVALIDO, MSG_EXTRA_SOLO_PROPIO, MSG_PERSONA_DUPLICADA } from "@/lib/tms/piloto-extra";
import { PATCH, POST } from "./route";

const ctx = { params: Promise.resolve({ slug: "kt-monaco" }) };
const post = (body: unknown) => POST(new Request("http://x/api", { method: "POST", body: JSON.stringify(body) }), ctx);
const patch = (body: unknown) => PATCH(new Request("http://x/api", { method: "PATCH", body: JSON.stringify(body) }), ctx);
const sumarDias = (fecha: string, n: number) => { const d = new Date(`${fecha}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const MANANA = sumarDias(hoyLocal(), 1);

let conexion: ReturnType<typeof crearConexion>;
let filaPlan: Record<string, unknown>;
let extraActual: { personal_id: number; nombre: string }[];
let auxiliaresActuales: Record<string, unknown>[];
let viaticosProcesados: Record<string, unknown>[];
let empleadosPiloto: Set<number>;
let dispPersonal: Record<string, unknown>[];

function crearConexion() {
  return {
    beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(),
    query: vi.fn(async (sql: string) => (String(sql).includes("GET_LOCK") ? [[{ l: 1 }]] : String(sql).includes("RELEASE_LOCK") ? [[{ l: 1 }]] : [[]])),
    execute: vi.fn(async () => [{ insertId: 91, affectedRows: 1 }]),
  };
}
const plan = (over: Record<string, unknown> = {}) => ({
  id: 40, codigo: "PLAN-40", estado: "Programado", fecha_plan: MANANA, hora_carga: "08:00:00", placa: "C-100", piloto: "Juan Pérez",
  piloto_id: 10, unidad_id: 3, regreso_estimado: null, tarifa_comercial: null, costo_operativo_referencia: null, referencia_cliente: null,
  flota_vehiculo_id: 55, pendiente_cierre: 0, ruta_id: null, tarifa_id: null, notas: null, tipo_viaje: "Propio", tc_vehiculo_id: null, ...over,
});
const disp = (personalId: number, nombre: string, over: Record<string, unknown> = {}) => ({
  personalId, nombre, incidenciasBloqueantes: [], viajeActual: null, estadoDisponibilidad: "disponible", otrosPlanesDelDia: [], advertencias: [], ...over,
});
const llamadas = (mock: { mock: { calls: unknown[][] } }, texto: string) => mock.mock.calls.filter((c) => String(c[0]).includes(texto));
const extraGuardado = () => llamadas(conexion.execute, "tms_plan_pilotos_adicionales");

beforeEach(() => {
  vi.resetAllMocks();
  conexion = crearConexion();
  filaPlan = plan();
  extraActual = [];
  auxiliaresActuales = [];
  viaticosProcesados = [];
  empleadosPiloto = new Set([200, 210]);
  dispPersonal = [disp(10, "Juan Pérez"), disp(30, "Carlos López"), disp(31, "Otro Piloto")];
  vi.mocked(requireTenantProgramacion).mockResolvedValue({ error: null, empresa: { id: 7, nombre: "KT" }, session: { username: "ops", id: 3, rol: "Operaciones" } } as never);
  vi.mocked(getPool).mockReturnValue({ getConnection: vi.fn().mockResolvedValue(conexion) } as never);
  vi.mocked(query).mockImplementation((async (sql: string, params: unknown[] = []) => {
    const s = String(sql);
    if (s.includes("FROM tms_planes_viaje p") && s.includes("WHERE p.id = ?") && s.includes("p.hora_carga")) return [filaPlan];
    if (s.includes("SELECT id, codigo, estado, tipo_viaje FROM tms_planes_viaje")) return [{ id: 40, codigo: "PLAN-40", estado: "Programado", tipo_viaje: "Propio" }];
    if (s.includes("FROM tms_plan_auxiliares a")) return auxiliaresActuales;
    if (s.includes("FROM tms_plan_pilotos_adicionales x")) return extraActual.map((e) => ({ plan_id: 40, ...e, id_empleado: 300 + e.personal_id, telefono: null }));
    if (s.includes("FROM tms_viaticos")) return viaticosProcesados;
    if (s.includes("FROM empleados") && s.includes("categoria_ops")) return empleadosPiloto.has(Number(params[0])) && Number(params[1]) === 7 ? [{ id: params[0] }] : [];
    if (s.includes("SELECT p.fecha_plan, u.placa, pil.nombre")) return [{ fecha_plan: filaPlan.fecha_plan, placa: "C-100", piloto: "Juan Pérez" }];
    return [];
  }) as never);
  vi.mocked(execute).mockResolvedValue({ insertId: 500, affectedRows: 1 } as never);
  vi.mocked(listarDisponibilidadPersonal).mockImplementation((async () => dispPersonal) as never);
  vi.mocked(validarPersonalId).mockImplementation((async (empresa: number, id: number, tipo: string) => (empresa === 7 && tipo === "Piloto" && [10, 30, 31].includes(id) ? { id, nombre: `Persona ${id}` } : null)) as never);
  vi.mocked(personalDesdeEmpleado).mockImplementation((async (_e: number, empleadoId: number) => ({ 100: 10, 200: 30, 210: 31, 300: 40 } as Record<number, number>)[empleadoId] ?? null) as never);
});

const BASE_POST = { fechaPlan: MANANA, horaCarga: "08:00", tipoViaje: "Propio", pilotoEmpleadoId: 100, paradas: [{ lugarNombre: "Bodega", tipo: "Carga" }, { lugarNombre: "Cliente", tipo: "Descarga" }] };

describe("POST — crear viaje", () => {
  it("1) un piloto: comportamiento de siempre (sin piloto extra, sin escritura en la tabla nueva, sync con pilotoExtra null)", async () => {
    const res = await post(BASE_POST);
    expect(res.status).toBe(200);
    expect(extraGuardado()).toHaveLength(0);
    expect(vi.mocked(sincronizarViaticosPlan).mock.calls[0][2]).toEqual({ piloto: 10, pilotoExtra: null, auxiliares: [] });
  });

  it("2) principal A + piloto extra B: B se guarda en la misma transacción (DELETE+INSERT), rol Piloto real de RRHH", async () => {
    const res = await post({ ...BASE_POST, pilotoExtraEmpleadoId: 200 });
    expect(res.status).toBe(200);
    const [del, ins] = extraGuardado();
    expect(String(del[0])).toContain("DELETE FROM tms_plan_pilotos_adicionales");
    expect(ins[1]).toEqual([7, 91, 30]); // empresa, plan creado, tms_personal del extra
    expect(conexion.commit).toHaveBeenCalledOnce();
    expect(personalDesdeEmpleado).toHaveBeenCalledWith(7, 200, "Piloto", undefined);
  });

  it("12/13) el extra recibe su PROPIO viático rol Piloto: sync con pilotoExtra y monto individual (14) por empleado", async () => {
    await post({ ...BASE_POST, pilotoExtraEmpleadoId: 200, viaticosAsignados: [{ empleadoId: 100, montoAsignado: 150 }, { empleadoId: 200, montoAsignado: 90 }] });
    const [empresa, , asignacion, , overrides] = vi.mocked(sincronizarViaticosPlan).mock.calls[0];
    expect(empresa).toBe(7);
    expect(asignacion).toEqual({ piloto: 10, pilotoExtra: 30, auxiliares: [] });
    expect(overrides).toEqual([{ personalId: 10, montoAsignado: 150 }, { personalId: 30, montoAsignado: 90 }]); // dos viáticos independientes, montos distintos
  });

  it("los viáticos solo aceptan empleados que SON piloto/extra/auxiliares de este viaje (nunca un tercero)", async () => {
    const res = await post({ ...BASE_POST, pilotoExtraEmpleadoId: 200, viaticosAsignados: [{ empleadoId: 999, montoAsignado: 10 }] });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("no corresponde al piloto/auxiliares de este viaje");
  });

  it("4/5) el extra no puede ser el mismo que el principal → 400 y no se crea nada", async () => {
    vi.mocked(personalDesdeEmpleado).mockImplementation((async () => 10) as never); // ambos empleados resuelven al mismo tms_personal
    const res = await post({ ...BASE_POST, pilotoExtraEmpleadoId: 200 });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(MSG_PERSONA_DUPLICADA);
    expect(conexion.commit).not.toHaveBeenCalled();
    expect(extraGuardado()).toHaveLength(0);
  });

  it("6) el extra no puede ser también auxiliar → 400", async () => {
    const res = await post({ ...BASE_POST, pilotoExtraEmpleadoId: 200, auxiliarEmpleadoIds: [200] });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(MSG_PERSONA_DUPLICADA);
  });

  it("solo RRHH: un empleado sin puesto de piloto / inactivo / de otra empresa se rechaza (sin texto libre)", async () => {
    const res = await post({ ...BASE_POST, pilotoExtraEmpleadoId: 999 });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(MSG_EXTRA_INVALIDO);
    expect(conexion.commit).not.toHaveBeenCalled();
  });

  it("el esquema no acepta nombre libre para el extra ni más de uno (pilotoExtraNombre / listas se ignoran o rechazan)", async () => {
    const res = await post({ ...BASE_POST, pilotoExtraEmpleadoId: 200, pilotoExtraNombre: "Persona Libre" });
    expect(res.status).toBe(200);
    expect(vi.mocked(sincronizarViaticosPlan).mock.calls[0][2]).toMatchObject({ pilotoExtra: 30 }); // el nombre libre no crea nada
    expect(vi.mocked(execute).mock.calls.some((c) => String(c[0]).includes("INSERT INTO tms_personal"))).toBe(false);
  });

  it("7/8) disponibilidad: el extra va al MISMO motor (recurso 'piloto') junto al principal", async () => {
    await post({ ...BASE_POST, pilotoExtraEmpleadoId: 200 });
    const recursos = vi.mocked(primerConflictoProgramacionIntervalo).mock.calls[0][1];
    expect(recursos).toEqual([{ tipo: "piloto", id: 10 }, { tipo: "piloto", id: 30 }]);
  });

  it("7) extra ocupado en otro viaje incompatible → 409 con el mensaje del motor y sin crear el viaje", async () => {
    vi.mocked(primerConflictoProgramacionIntervalo).mockResolvedValue({ tipo: "piloto", id: 30, nombre: "Carlos López", planIdConflicto: 9, codigoConflicto: "PLAN-9", inicioConflicto: `${MANANA} 06:00:00`, finConflicto: `${MANANA} 12:00:00` } as never);
    const res = await post({ ...BASE_POST, pilotoExtraEmpleadoId: 200 });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("Carlos López");
    expect(conexion.commit).not.toHaveBeenCalled();
    expect(extraGuardado()).toHaveLength(0);
  });

  it("19) Tercerizado no admite piloto extra interno → 400", async () => {
    const res = await post({ fechaPlan: MANANA, horaCarga: "08:00", tipoViaje: "Tercerizado", pilotoExternoNombre: "Externo", pilotoExtraEmpleadoId: 200 });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(MSG_EXTRA_SOLO_PROPIO);
    expect(extraGuardado()).toHaveLength(0);
  });
});

describe("PATCH — editar viaje", () => {
  const conExtra = () => { extraActual = [{ personal_id: 30, nombre: "Carlos López" }]; };

  it("17) editar solo tarifa/notas NO toca el extra: no se reescribe ni se sincronizan viáticos", async () => {
    conExtra();
    const res = await patch({ id: 40, notas: "solo notas", tarifaComercial: 1000 });
    expect(res.status).toBe(200);
    expect(extraGuardado()).toHaveLength(0);
    expect(vi.mocked(sincronizarViaticosPlan)).not.toHaveBeenCalled();
    expect(guardarAuxiliaresPlan).not.toHaveBeenCalled();
  });

  it("cambio sensible: asignar extra exige MOTIVO (igual que piloto/unidad/auxiliares)", async () => {
    const res = await patch({ id: 40, pilotoExtraPersonalId: 30 });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Indica el motivo del cambio de piloto, unidad o auxiliares.");
    expect(conexion.commit).not.toHaveBeenCalled();
  });

  it("asignar extra con motivo: revalida disponibilidad (rol piloto), guarda en la transacción y sincroniza su viático", async () => {
    const res = await patch({ id: 40, pilotoExtraPersonalId: 30, motivoCambio: "Ruta larga" });
    expect(res.status).toBe(200);
    expect(extraGuardado().map((c) => String(c[0]).split(" ")[0])).toEqual(["DELETE", "INSERT"]);
    expect(extraGuardado()[1][1]).toEqual([7, 40, 30]);
    expect(vi.mocked(primerConflictoProgramacionIntervalo).mock.calls[0][1]).toContainEqual({ tipo: "piloto", id: 30 });
    expect(vi.mocked(sincronizarViaticosPlan).mock.calls[0][2]).toEqual({ piloto: 10, pilotoExtra: 30, auxiliares: [] });
  });

  it("11) extra con incidencia bloqueante → 409 (mismas reglas que el principal) y nada se guarda", async () => {
    dispPersonal = [disp(30, "Carlos López", { incidenciasBloqueantes: [{ tipo: "Suspensión", fechaInicio: MANANA, fechaFin: MANANA }] })];
    const res = await patch({ id: 40, pilotoExtraPersonalId: 30, motivoCambio: "Ruta larga" });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("incidencia (Suspensión)");
    expect(getPool).not.toHaveBeenCalled();
  });

  it("7) extra ocupado en otro plan (motor por intervalos) → 409 + rollback", async () => {
    vi.mocked(primerConflictoProgramacionIntervalo).mockResolvedValue({ tipo: "piloto", id: 30, nombre: "Carlos López", planIdConflicto: 9, codigoConflicto: "PLAN-9", inicioConflicto: `${MANANA} 06:00:00`, finConflicto: `${MANANA} 12:00:00` } as never);
    const res = await patch({ id: 40, pilotoExtraPersonalId: 30, motivoCambio: "Ruta larga" });
    expect(res.status).toBe(409);
    expect(conexion.rollback).toHaveBeenCalled();
    expect(conexion.commit).not.toHaveBeenCalled();
  });

  it("4/5/6) extra == principal / extra == auxiliar actual → 400 con el mensaje de negocio", async () => {
    let res = await patch({ id: 40, pilotoExtraPersonalId: 10, motivoCambio: "x" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(MSG_PERSONA_DUPLICADA);
    auxiliaresActuales = [{ plan_id: 40, personal_id: 31, id_empleado: 331, nombre: "Aux", telefono: null }];
    res = await patch({ id: 40, pilotoExtraPersonalId: 31, motivoCambio: "x" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(MSG_PERSONA_DUPLICADA);
  });

  it("21) tenant: un piloto de otra empresa / inexistente como extra → 400 (validado contra la empresa de la sesión)", async () => {
    const res = await patch({ id: 40, pilotoExtraPersonalId: 999, motivoCambio: "x" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(MSG_EXTRA_INVALIDO);
    expect(validarPersonalId).toHaveBeenCalledWith(7, 999, "Piloto");
  });

  it("por empleado de RRHH: solo activo con puesto de piloto de esta empresa", async () => {
    let res = await patch({ id: 40, pilotoExtraEmpleadoId: 999, motivoCambio: "x" });
    expect(res.status).toBe(400);
    res = await patch({ id: 40, pilotoExtraEmpleadoId: 200, motivoCambio: "x" });
    expect(res.status).toBe(200);
    expect(extraGuardado()[1][1]).toEqual([7, 40, 30]);
  });

  it("15) quitar el extra (null) con viático PROGRAMADO: permitido y sincroniza (el viático PROGRAMADO se elimina en la sincronización)", async () => {
    conExtra();
    const res = await patch({ id: 40, pilotoExtraPersonalId: null, motivoCambio: "Ya no viaja" });
    expect(res.status).toBe(200);
    expect(extraGuardado().map((c) => String(c[0]).split(" ")[0])).toEqual(["DELETE"]); // solo quita
    expect(vi.mocked(sincronizarViaticosPlan).mock.calls[0][2]).toEqual({ piloto: 10, pilotoExtra: null, auxiliares: [] });
  });

  it("16) quitar el extra con viático AUTORIZADO/ENTREGADO/LIQUIDADO → 409 y no se escribe nada", async () => {
    for (const estado of ["AUTORIZADO", "ENTREGADO", "LIQUIDADO"]) {
      conexion = crearConexion();
      vi.mocked(getPool).mockReturnValue({ getConnection: vi.fn().mockResolvedValue(conexion) } as never);
      conExtra();
      viaticosProcesados = [{ personal_id: 30, estado }];
      const res = await patch({ id: 40, pilotoExtraPersonalId: null, motivoCambio: "Ya no viaja" });
      expect(res.status).toBe(409);
      expect((await res.json()).error).toContain(`viático ya fue ${estado.toLowerCase()}`);
      expect(conexion.commit).not.toHaveBeenCalled();
      expect(extraGuardado()).toHaveLength(0);
    }
  });

  it("cambiar de extra B → C también bloquea si B tiene viático procesado; y una persona que solo cambia de rol dentro del viaje NO cuenta como removida", async () => {
    conExtra();
    viaticosProcesados = [{ personal_id: 30, estado: "AUTORIZADO" }];
    expect((await patch({ id: 40, pilotoExtraPersonalId: 31, motivoCambio: "Cambio" })).status).toBe(409);
    // B pasa a ser el principal y el principal anterior queda como extra: nadie sale del viaje
    conexion = crearConexion();
    vi.mocked(getPool).mockReturnValue({ getConnection: vi.fn().mockResolvedValue(conexion) } as never);
    const res = await patch({ id: 40, pilotoPersonalId: 30, pilotoExtraPersonalId: 10, motivoCambio: "Intercambio" });
    expect(res.status).toBe(200);
  });

  it("cambiar la FECHA revalida también al extra ya guardado", async () => {
    conExtra();
    dispPersonal = [disp(10, "Juan Pérez"), disp(30, "Carlos López", { incidenciasBloqueantes: [{ tipo: "Vacaciones", fechaInicio: sumarDias(MANANA, 1), fechaFin: sumarDias(MANANA, 3) }] })];
    const res = await patch({ id: 40, fechaPlan: sumarDias(MANANA, 2) });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("incidencia (Vacaciones)");
  });

  it("19) Tercerizado (actual) no admite un piloto extra", async () => {
    filaPlan = plan({ tipo_viaje: "Tercerizado", piloto_id: null, piloto: "" });
    const res = await patch({ id: 40, pilotoExtraPersonalId: 30, motivoCambio: "x" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(MSG_EXTRA_SOLO_PROPIO);
  });

  it("19b) Propio → Tercerizado: quita el extra y su viático PROGRAMADO en la misma transacción; con viático procesado se BLOQUEA (409)", async () => {
    filaPlan = plan();
    conExtra();
    const body = { id: 40, tipoViaje: "Tercerizado", pilotoExternoNombre: "Externo" };
    let res = await patch(body);
    expect(res.status).toBe(200);
    expect(extraGuardado().map((c) => String(c[0]).split(" ")[0])).toEqual(["DELETE"]);
    expect(vi.mocked(sincronizarViaticosPlan).mock.calls[0][2]).toEqual({ piloto: null, pilotoExtra: null, auxiliares: [] });
    conexion = crearConexion();
    vi.mocked(getPool).mockReturnValue({ getConnection: vi.fn().mockResolvedValue(conexion) } as never);
    viaticosProcesados = [{ personal_id: 30, estado: "ENTREGADO" }];
    res = await patch(body);
    expect(res.status).toBe(409);
    expect(conexion.commit).not.toHaveBeenCalled();
  });
});
