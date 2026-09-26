import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * PROGRAMACIÓN — EDICIÓN RÁPIDA PR-2: guardado atómico del estado final. BD en memoria TRANSACCIONAL: BEGIN toma un
 * respaldo y ROLLBACK lo restaura (rollback verificable). El SQL real del núcleo (PR-1) y del motor de intervalos se
 * emula a partir del texto/parámetros enviados; las validaciones y el orden de operaciones son los de producción.
 */
const h = vi.hoisted(() => ({ eventos: [] as string[], falla: { en: null as null | string, nUpdate: 0, nAudit: 0 }, lockDisponible: true }));

vi.mock("@/lib/db", () => ({ query: vi.fn(), execute: vi.fn(), getPool: vi.fn() }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoriaTx: vi.fn() }));
vi.mock("@/lib/flota/acceso", () => ({ obtenerVehiculoAccesible: vi.fn() }));
vi.mock("@/lib/operaciones/disponibilidad", () => ({ listarDisponibilidadVehiculos: vi.fn() }));
vi.mock("@/lib/operaciones/disponibilidad-personal", () => ({ listarDisponibilidadPersonal: vi.fn() }));
vi.mock("@/lib/tms/plan-comunes", () => ({ guardarAuxiliaresPlan: vi.fn() }));
vi.mock("@/lib/tms/viaticos", () => ({
  listarViaticosRechazadosDelPlan: vi.fn(async () => []),
  personalRecienAsignadoDelPlan: vi.fn(() => []),
  sincronizarViaticosPlan: vi.fn(),
}));
vi.mock("@/lib/tms/personal-resolucion", () => ({ personalDesdeEmpleado: vi.fn(), validarPersonalId: vi.fn() }));
vi.mock("@/lib/tms/tc-plan", () => ({ resolverTcInterno: vi.fn() }));

import { getPool, query } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import { obtenerVehiculoAccesible } from "@/lib/flota/acceso";
import { listarDisponibilidadVehiculos } from "@/lib/operaciones/disponibilidad";
import { listarDisponibilidadPersonal } from "@/lib/operaciones/disponibilidad-personal";
import { hoyLocal } from "@/lib/rrhh/dates";
import { guardarAuxiliaresPlan } from "@/lib/tms/plan-comunes";
import { personalDesdeEmpleado, validarPersonalId } from "@/lib/tms/personal-resolucion";
import { resolverTcInterno } from "@/lib/tms/tc-plan";
import { sincronizarViaticosPlan } from "@/lib/tms/viaticos";
import { emularConsultaConflictoPersonal, type PersonalModelo } from "@/lib/tms/personal-identidad.fixture";
import { ESTADOS_ASIGNACION_DIARIA } from "./disponibilidad-programacion-dia";
import { validarEdicionRapidaSchema, type ValidarEdicionRapida } from "./edicion-rapida-schema";
import { validarEdicionRapida } from "./edicion-rapida-validar";
import { guardarEdicionRapida, MSG_CAMBIOS_INVALIDOS, MSG_LOCK_EDICION_RAPIDA } from "./edicion-rapida-guardar";

const EMP = 7;
const sumarDias = (fecha: string, n: number) => { const d = new Date(`${fecha}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const HOY = hoyLocal();
const D0 = sumarDias(HOY, 10);
const AYER = sumarDias(HOY, -1);

type Persona = PersonalModelo & { estado: string };
type Plan = {
  id: number; empresa_id: number; codigo: string; estado: string; fecha: string; hora: string | null; regreso: string | null; tipo_viaje: string;
  piloto_id: number | null; auxiliar_id: number | null; aux: number[]; extra?: number | null; unidad_tms: number | null; tc: number | null; pendiente?: boolean;
};
type Unidad = { id: number; placa: string; flota: number | null };
type Modelo = { planes: Plan[]; unidades: Unidad[] };
let personal: Persona[];
let m: Modelo;
let respaldo = "";
let viaticos: { plan_id: number; personal_id: number; estado: string }[];
let auditorias: { usuario: string | null | undefined; accion: string; detalle: string | undefined }[];
let updates: { sql: string; params: unknown[] }[];
let syncs: { planId: number; asignacion: unknown }[];

const persona = (id: number, nombre: string, idEmpleado: number | null, tipo: "Piloto" | "Auxiliar" = "Piloto"): Persona => ({ id, empresa_id: EMP, nombre, tipo, id_empleado: idEmpleado, estado: "Activo" });
const plan = (id: number, over: Partial<Plan> = {}): Plan => ({
  id, empresa_id: EMP, codigo: `PLAN-${id}`, estado: "Programado", fecha: D0, hora: "05:00:00", regreso: `${D0} 08:00:00`, tipo_viaje: "Propio",
  piloto_id: null, auxiliar_id: null, aux: [], unidad_tms: null, tc: null, ...over,
});
const unidadDe = (id: number | null) => m.unidades.find((u) => u.id === id);

function crearConexion() {
  const conn = {
    beginTransaction: vi.fn(async () => { h.eventos.push("begin"); respaldo = JSON.stringify(m); }),
    commit: vi.fn(async () => { h.eventos.push("commit"); }),
    rollback: vi.fn(async () => { h.eventos.push("rollback"); if (respaldo) m = JSON.parse(respaldo); }),
    release: vi.fn(async () => { h.eventos.push("release"); }),
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      const s = String(sql);
      if (s.includes("GET_LOCK")) { h.eventos.push(h.lockDisponible ? "lock" : "lock-fallido"); return [[{ l: h.lockDisponible ? 1 : 0 }]]; }
      if (s.includes("RELEASE_LOCK")) { h.eventos.push("unlock"); return [[{ l: 1 }]]; }
      if (s.includes("FROM tms_planes_viaje") && s.includes("ORDER BY id FOR UPDATE")) { h.eventos.push("forupdate-planes"); return [[]]; }
      return [await responder(s, params)];
    }),
    execute: vi.fn(async (sql: string, params: unknown[] = []) => {
      const s = String(sql);
      if (s.startsWith("UPDATE tms_planes_viaje SET")) {
        h.eventos.push("update");
        updates.push({ sql: s, params });
        if (h.falla.en === "update" && updates.length >= h.falla.nUpdate) throw new Error("fallo UPDATE");
        const cols = s.slice("UPDATE tms_planes_viaje SET ".length, s.indexOf(" WHERE")).split(", ").map((c) => c.split(" = ")[0]);
        const [id, empresa, estado] = params.slice(cols.length) as [number, number, string];
        const p = m.planes.find((x) => x.id === id && x.empresa_id === empresa && x.estado === estado);
        if (!p) return [{ affectedRows: 0 }];
        cols.forEach((c, i) => {
          const v = params[i] as number | null;
          if (c === "piloto_id") p.piloto_id = v; else if (c === "auxiliar_id") p.auxiliar_id = v; else if (c === "unidad_id") p.unidad_tms = v; else if (c === "tc_vehiculo_id") p.tc = v;
        });
        return [{ affectedRows: 1 }];
      }
      if (s.includes("INSERT INTO tms_unidades")) {
        h.eventos.push("unidad");
        const [, placa, flota] = params as [number, string, number];
        let u = m.unidades.find((x) => x.placa === placa);
        if (!u) { u = { id: 900 + m.unidades.length, placa, flota }; m.unidades.push(u); } else if (u.flota == null) u.flota = flota;
        return [{ insertId: u.id, affectedRows: 1 }];
      }
      throw new Error(`SQL de escritura inesperado: ${s.slice(0, 60)}`);
    }),
  };
  return conn;
}
let conn: ReturnType<typeof crearConexion>;

/** Lecturas (pool o conexión): planes del lote, auxiliares, personal, unidades TMS, viáticos y motor de intervalos. */
async function responder(s: string, params: unknown[]): Promise<unknown[]> {
  const empresa = Number(params[0]);
  if (s.includes("FROM tms_planes_viaje p") && s.includes("LEFT JOIN tms_unidades u ON u.id = p.unidad_id") && s.includes("p.id IN")) {
    const ids = params.slice(1) as number[];
    return m.planes.filter((p) => p.empresa_id === empresa && ids.includes(p.id)).map((p) => ({
      id: p.id, codigo: p.codigo, estado: p.estado, fecha_plan: p.fecha, hora_carga: p.hora, regreso_estimado: p.regreso, tipo_viaje: p.tipo_viaje, piloto_id: p.piloto_id,
      unidad_id: p.unidad_tms, unidad_placa: unidadDe(p.unidad_tms)?.placa ?? null, flota_vehiculo_id: unidadDe(p.unidad_tms)?.flota ?? null, tc_vehiculo_id: p.tc,
      piloto_nombre: personal.find((x) => x.id === p.piloto_id)?.nombre ?? null, pendiente_cierre: p.pendiente ? 1 : 0,
    }));
  }
  if (s.includes("FROM tms_plan_pilotos_adicionales WHERE empresa_id = ?")) {
    const ids = params.slice(1) as number[];
    return m.planes.filter((p) => ids.includes(p.id) && p.empresa_id === empresa && p.extra != null).map((p) => ({ plan_id: p.id, personal_id: p.extra }));
  }
  if (s.includes("FROM tms_plan_auxiliares pa") && s.includes("per.empresa_id = ?")) {
    const ids = params.slice(1) as number[];
    return m.planes.filter((p) => ids.includes(p.id) && p.empresa_id === empresa).flatMap((p) => p.aux.map((a, i) => ({ plan_id: p.id, personal_id: a, nombre: personal.find((x) => x.id === a)?.nombre, orden: i + 1 })));
  }
  if (s.startsWith("SELECT id, id_empleado, nombre FROM tms_personal WHERE empresa_id")) {
    const ids = params.slice(1) as number[];
    return personal.filter((p) => p.empresa_id === empresa && ids.includes(p.id)).map((p) => ({ id: p.id, id_empleado: p.id_empleado, nombre: p.nombre }));
  }
  if (s.includes("FROM tms_unidades WHERE empresa_id")) {
    const placas = params.slice(1) as string[];
    return m.unidades.filter((u) => placas.includes(u.placa)).map((u) => ({ id: u.id, placa: u.placa }));
  }
  if (s.includes("FROM tms_viaticos") && s.includes("estado != 'PROGRAMADO'")) {
    const [planId, ...ids] = params as number[];
    return viaticos.filter((v) => v.plan_id === planId && ids.includes(v.personal_id));
  }
  if (s.includes("FROM flota_vehiculos WHERE id IN")) return (params as number[]).map((id) => ({ id, placa: `TC-${id}` }));
  const n = ESTADOS_ASIGNACION_DIARIA.length;
  if (s.includes("p.fecha_plan <= ?")) {
    const nEx = (/p\.id NOT IN \(([?,]+)\)/.exec(s)?.[1].split(",").length) ?? 0;
    const excl = (nEx ? params.slice(-nEx) : []) as number[];
    const fechaFin = String(params[1 + n]), fechaInicio = String(params[2 + n]), inicio = String(params[3 + n]);
    const visible = (p: Plan) => p.empresa_id === empresa && (ESTADOS_ASIGNACION_DIARIA as readonly string[]).includes(p.estado) && p.tipo_viaje !== "Tercerizado" && !excl.includes(p.id)
      && p.fecha <= fechaFin && (p.fecha >= fechaInicio || (p.regreso != null && p.regreso > inicio));
    const fila = (p: Plan, rid: unknown, nombre: unknown) => ({ recurso_id: rid, nombre, plan_id: p.id, codigo: p.codigo, fecha_plan: p.fecha, hora_carga: p.hora, regreso_estimado: p.regreso });
    if (s.includes("FROM tms_personal tp")) {
      const modelo = { personal: personal as PersonalModelo[], planes: m.planes.filter((p) => p.tipo_viaje !== "Tercerizado").map((p) => ({ id: p.id, empresa_id: p.empresa_id, codigo: p.codigo, estado: p.estado, inicio: `${p.fecha} ${(p.hora ?? "00:00:00")}`, regreso_estimado: p.regreso, piloto_id: p.piloto_id, pilotoExtra: p.extra ?? null, auxiliar_id: p.auxiliar_id, auxiliares: p.aux, hora_carga: p.hora })) };
      return emularConsultaConflictoPersonal(modelo, s, params);
    }
    if (s.includes("FROM tms_unidades u")) {
      const ids = params.slice(4 + n, params.length - nEx) as number[];
      return m.planes.filter((p) => visible(p) && p.unidad_tms != null && ids.includes(p.unidad_tms)).map((p) => fila(p, p.unidad_tms, unidadDe(p.unidad_tms)?.placa));
    }
    if (s.includes("p.tc_vehiculo_id = v.id")) {
      const ids = params.slice(4 + n, params.length - nEx) as number[];
      return m.planes.filter((p) => visible(p) && p.tc != null && ids.includes(p.tc)).map((p) => fila(p, p.tc, `TC-${p.tc}`));
    }
  }
  return [];
}

beforeEach(() => {
  vi.resetAllMocks();
  h.eventos = []; h.falla = { en: null, nUpdate: 0, nAudit: 0 }; h.lockDisponible = true;
  respaldo = ""; viaticos = []; auditorias = []; updates = []; syncs = [];
  personal = [persona(10, "Carlos", 100), persona(11, "Juan", 101), persona(12, "Luis", 102), persona(13, "Juan (aux)", 101, "Auxiliar"), persona(20, "Pedro", 200, "Auxiliar"), persona(21, "Mario", 201, "Auxiliar")];
  m = {
    unidades: [{ id: 300, placa: "C-30", flota: 30 }, { id: 301, placa: "C-31", flota: 31 }],
    planes: [
      plan(101, { piloto_id: 10, auxiliar_id: 20, aux: [20], unidad_tms: 300, tc: 40 }),
      plan(102, { hora: "08:00:00", regreso: `${D0} 11:00:00`, piloto_id: 11, unidad_tms: 301, tc: 41 }),
      plan(103, { hora: "11:00:00", regreso: `${D0} 13:00:00`, piloto_id: 12 }),
    ],
  };
  conn = crearConexion();
  vi.mocked(getPool).mockReturnValue({ getConnection: vi.fn().mockResolvedValue(conn) } as never);
  vi.mocked(query).mockImplementation((async (sql: string, params: unknown[] = []) => responder(String(sql), params)) as never);
  vi.mocked(validarPersonalId).mockImplementation((async (empresa: number, id: number, tipo: string) => {
    const p = personal.find((x) => x.id === id && x.empresa_id === empresa && x.tipo === tipo && x.estado === "Activo");
    return p ? { id: p.id, nombre: p.nombre } : null;
  }) as never);
  vi.mocked(listarDisponibilidadPersonal).mockImplementation((async () => personal.map((p) => ({
    personalId: p.id, nombre: p.nombre, incidenciasBloqueantes: [], viajeActual: null, estadoDisponibilidad: "disponible", otrosPlanesDelDia: [], advertencias: [],
  }))) as never);
  vi.mocked(obtenerVehiculoAccesible).mockImplementation((async (_e: number, id: number) => ({ id, placa: `C-${id}` })) as never);
  vi.mocked(listarDisponibilidadVehiculos).mockResolvedValue({ vehiculos: [30, 31, 32, 33].map((id) => ({ id, placa: `C-${id}`, tipoUnidad: "Camion", estadoDisponibilidad: "disponible", viajeAbierto: null })) } as never);
  vi.mocked(resolverTcInterno).mockImplementation((async (_e: number, id: number) => ({ ok: true, vehiculoId: id, placa: `TC-${id}` })) as never);
  vi.mocked(guardarAuxiliaresPlan).mockImplementation((async (planId: number, ids: number[]) => {
    h.eventos.push("aux");
    if (h.falla.en === "aux") throw new Error("fallo auxiliares");
    const p = m.planes.find((x) => x.id === planId)!; p.aux = [...ids];
  }) as never);
  vi.mocked(sincronizarViaticosPlan).mockImplementation((async (_e: number, planId: number, asignacion: unknown) => {
    h.eventos.push("viaticos");
    if (h.falla.en === "viaticos") throw new Error("fallo viáticos");
    syncs.push({ planId, asignacion });
  }) as never);
  vi.mocked(registrarAuditoriaTx).mockImplementation((async (_c: unknown, a: { usuario?: string | null; accion: string; detalle?: string }) => {
    h.eventos.push("auditoria");
    if (h.falla.en === "auditoria" && auditorias.length + 1 >= h.falla.nAudit) throw new Error("fallo auditoría");
    auditorias.push({ usuario: a.usuario, accion: a.accion, detalle: a.detalle });
  }) as never);
});

const cambio = (planId: number, nuevo: Partial<{ pilotoPersonalId: number | null; auxiliarPersonalIds: number[]; flotaVehiculoId: number | null; tcVehiculoId: number | null }> = {}, esperado: Record<string, unknown> = {}) => {
  const p = m.planes.find((x) => x.id === planId) ?? plan(planId);
  const u = unidadDe(p.unidad_tms);
  return {
    planId,
    esperado: { estado: p.estado, fechaPlan: p.fecha, horaCarga: p.hora ? p.hora.slice(0, 5) : null, regresoEstimado: p.regreso ? p.regreso.slice(0, 16).replace(" ", "T") : null,
      pilotoPersonalId: p.piloto_id, auxiliarPersonalIds: p.aux, flotaVehiculoId: u?.flota ?? null, tcVehiculoId: p.tc, ...esperado },
    nuevo: { pilotoPersonalId: p.piloto_id, auxiliarPersonalIds: p.aux, flotaVehiculoId: u?.flota ?? null, tcVehiculoId: p.tc, ...nuevo },
  };
};
const datos = (cambios: ReturnType<typeof cambio>[], motivoCambio: string | undefined = "Piloto no se presentó") => validarEdicionRapidaSchema.parse({ motivoCambio, cambios }) as ValidarEdicionRapida;
const guardar = (cambios: ReturnType<typeof cambio>[], motivo?: string, usuario = "ops") => guardarEdicionRapida(EMP, usuario, datos(cambios, motivo));
const p = (id: number) => m.planes.find((x) => x.id === id)!;
const snapshot = () => JSON.stringify(m);
const codigos = (r: Awaited<ReturnType<typeof guardar>>, planId: number) => (!r.ok && "filas" in r ? (r.filas ?? []).find((f) => f.planId === planId)?.errores.map((e) => e.codigo) ?? [] : []);

describe("atomicidad y orden de operaciones", () => {
  it("1) dos filas válidas: ambas se guardan (respuesta, UPDATE y auditoría por plan)", async () => {
    const r = await guardar([cambio(101, { pilotoPersonalId: 12 }), cambio(102, { pilotoPersonalId: 10 })]);
    expect(r).toEqual({ ok: true, guardados: 2, filas: [{ planId: 101, estado: "guardado" }, { planId: 102, estado: "guardado" }] });
    expect([p(101).piloto_id, p(102).piloto_id]).toEqual([12, 10]);
    expect(auditorias).toHaveLength(2);
  });

  it("7/orden) GET_LOCK -> BEGIN -> FOR UPDATE -> UPDATE de todos -> auxiliares -> viáticos -> auditoría -> COMMIT -> RELEASE_LOCK", async () => {
    await guardar([cambio(101, { pilotoPersonalId: 12, auxiliarPersonalIds: [21, 20] }), cambio(102, { pilotoPersonalId: 10, auxiliarPersonalIds: [20] })]);
    expect(h.eventos).toEqual([
      "lock", "begin", "forupdate-planes",
      "update", "update", "aux", "aux", "viaticos", "viaticos", "auditoria", "auditoria",
      "commit", "unlock", "release",
    ]);
  });

  it("2) la segunda fila falla en la validación definitiva: NINGUNA se guarda (rollback, sin UPDATE)", async () => {
    const antes = snapshot();
    const r = await guardar([cambio(101, { pilotoPersonalId: 12 }), cambio(102, { pilotoPersonalId: 999 })]);
    expect(r).toMatchObject({ ok: false, status: 409, error: MSG_CAMBIOS_INVALIDOS });
    expect(codigos(r, 102)).toEqual(["PERSONAL_INVALIDO"]);
    expect(snapshot()).toBe(antes);
    expect(updates).toHaveLength(0);
    expect(h.eventos).toEqual(["lock", "begin", "forupdate-planes", "rollback", "unlock", "release"]);
    expect(auditorias).toHaveLength(0);
  });

  it("3) un error en el UPDATE de la segunda fila revierte la primera", async () => {
    const antes = snapshot();
    h.falla = { en: "update", nUpdate: 2, nAudit: 0 };
    const r = await guardar([cambio(101, { pilotoPersonalId: 12 }), cambio(102, { pilotoPersonalId: 10 })]);
    expect(r).toMatchObject({ ok: false, status: 500 });
    expect(updates).toHaveLength(2); // el primero llegó a ejecutarse...
    expect(snapshot()).toBe(antes); // ...y se revirtió
    expect(h.eventos.at(-3)).toBe("rollback");
  });

  it("4) un error guardando auxiliares revierte todo", async () => {
    const antes = snapshot();
    h.falla = { en: "aux", nUpdate: 0, nAudit: 0 };
    const r = await guardar([cambio(101, { pilotoPersonalId: 12, auxiliarPersonalIds: [21] }), cambio(102, { pilotoPersonalId: 10 })]);
    expect(r).toMatchObject({ ok: false, status: 500 });
    expect(snapshot()).toBe(antes);
    expect(h.eventos).not.toContain("commit");
  });

  it("5) un error sincronizando viáticos revierte todo", async () => {
    const antes = snapshot();
    h.falla = { en: "viaticos", nUpdate: 0, nAudit: 0 };
    const r = await guardar([cambio(101, { pilotoPersonalId: 12 }), cambio(102, { pilotoPersonalId: 10 })]);
    expect(r).toMatchObject({ ok: false, status: 500 });
    expect(snapshot()).toBe(antes);
    expect(h.eventos).not.toContain("commit");
  });

  it("6) un error de auditoría en el segundo plan revierte todo (la auditoría es parte de la transacción)", async () => {
    const antes = snapshot();
    h.falla = { en: "auditoria", nUpdate: 0, nAudit: 2 };
    const r = await guardar([cambio(101, { pilotoPersonalId: 12 }), cambio(102, { pilotoPersonalId: 10 })]);
    expect(r).toMatchObject({ ok: false, status: 500 });
    expect(snapshot()).toBe(antes);
    expect(h.eventos).not.toContain("commit");
  });

  it("7) el COMMIT ocurre solo al final, después de todo lo demás", async () => {
    await guardar([cambio(101, { pilotoPersonalId: 12 }), cambio(102, { pilotoPersonalId: 10 })]);
    const i = h.eventos.indexOf("commit");
    expect(h.eventos.slice(i + 1)).toEqual(["unlock", "release"]);
    expect(h.eventos.slice(0, i).every((e) => e !== "commit")).toBe(true);
    expect(conn.commit).toHaveBeenCalledTimes(1);
  });

  it("8) RELEASE_LOCK se ejecuta también con error y con validación fallida", async () => {
    h.falla = { en: "aux", nUpdate: 0, nAudit: 0 };
    await guardar([cambio(101, { auxiliarPersonalIds: [21] })]);
    expect(h.eventos).toContain("unlock");
    h.eventos = []; h.falla = { en: null, nUpdate: 0, nAudit: 0 };
    await guardar([cambio(101, { pilotoPersonalId: 999 })]);
    expect(h.eventos).toContain("unlock");
    expect(conn.release).toHaveBeenCalled();
  });

  it("14) sin GET_LOCK: 409, sin BEGIN, sin UPDATE y sin RELEASE_LOCK (no había candado)", async () => {
    h.lockDisponible = false;
    const antes = snapshot();
    const r = await guardar([cambio(101, { pilotoPersonalId: 12 })]);
    expect(r).toEqual({ ok: false, status: 409, error: MSG_LOCK_EDICION_RAPIDA });
    expect(h.eventos).toEqual(["lock-fallido", "release"]);
    expect(snapshot()).toBe(antes);
    expect(updates).toHaveLength(0);
  });
});

describe("concurrencia: dos usuarios sobre el mismo viaje", () => {
  it("9-13) A guarda; B (snapshot viejo) obtiene el lock después, relee y ve PLAN_DESACTUALIZADO: NO sobrescribe a A", async () => {
    const snapshotB = cambio(101, { pilotoPersonalId: 11 }); // B vio a Carlos en el plan 101
    const previewB = await validarEdicionRapida(EMP, datos([snapshotB]));
    expect(previewB.ok).toBe(true); // el preview de B era válido
    expect((await guardar([cambio(101, { pilotoPersonalId: 12 })], "A", "userA")).ok).toBe(true); // A gana
    expect(p(101).piloto_id).toBe(12);
    h.eventos = []; updates = [];
    const rB = await guardar([snapshotB], "B", "userB");
    expect(rB).toMatchObject({ ok: false, status: 409, error: MSG_CAMBIOS_INVALIDOS });
    expect(codigos(rB, 101)).toEqual(["PLAN_DESACTUALIZADO"]);
    expect(p(101).piloto_id).toBe(12); // lo de A sigue intacto
    expect(updates).toHaveLength(0);
    expect(auditorias.map((a) => a.usuario)).toEqual(["userA"]);
    expect(h.eventos).toEqual(["lock", "begin", "forupdate-planes", "rollback", "unlock", "release"]);
  });

  const concurrente = async (mutar: () => void) => {
    const c = cambio(101, { pilotoPersonalId: 12 });
    expect((await validarEdicionRapida(EMP, datos([c]))).ok).toBe(true); // el preview pasó
    mutar(); // otro usuario cambia el viaje entre el preview y el guardado
    const despues = snapshot();
    const r = await guardar([c]);
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect(codigos(r, 101)).toEqual(["PLAN_DESACTUALIZADO"]);
    expect(snapshot()).toBe(despues);
    expect(updates).toHaveLength(0);
    expect(h.eventos).not.toContain("commit");
  };
  it("32) cambio concurrente de piloto", () => concurrente(() => { p(101).piloto_id = 11; }));
  it("33) cambio concurrente de auxiliar", () => concurrente(() => { p(101).aux = [21]; p(101).auxiliar_id = 21; }));
  it("34) cambio concurrente de unidad", () => concurrente(() => { p(101).unidad_tms = 301; }));
  it("35) cambio concurrente de TC", () => concurrente(() => { p(101).tc = 42; }));
  it("36) cambio concurrente de hora, regreso y estado", async () => {
    await concurrente(() => { p(101).hora = "06:00:00"; });
    await concurrente(() => { p(101).regreso = `${D0} 09:00:00`; });
    await concurrente(() => { p(101).estado = "Cargado"; });
  });

  it("el preview (/validar) NO toma lock ni transacción; el guardado sí", async () => {
    h.eventos = [];
    await validarEdicionRapida(EMP, datos([cambio(101, { pilotoPersonalId: 12 })]));
    expect(h.eventos).toEqual([]);
    expect(getPool).not.toHaveBeenCalled();
  });
});

describe("intercambios y rotaciones (validación del estado FINAL antes de aplicar)", () => {
  it("15) intercambio de 2 pilotos, incluso con los viajes solapados (cada piloto termina en un solo viaje)", async () => {
    p(101).regreso = `${D0} 09:00:00`; // 05-09 y 08-11 se solapan
    const r = await guardar([cambio(101, { pilotoPersonalId: 11 }), cambio(102, { pilotoPersonalId: 10 })]);
    expect(r).toMatchObject({ ok: true, guardados: 2 });
    expect([p(101).piloto_id, p(102).piloto_id]).toEqual([11, 10]);
    expect(updates).toHaveLength(2); // dos UPDATE, no uno por estado intermedio validado
  });

  it("16) rotación de 3 pilotos A->B, B->C, C->A", async () => {
    const r = await guardar([cambio(101, { pilotoPersonalId: 11 }), cambio(102, { pilotoPersonalId: 12 }), cambio(103, { pilotoPersonalId: 10 })]);
    expect(r).toMatchObject({ ok: true, guardados: 3 });
    expect([p(101).piloto_id, p(102).piloto_id, p(103).piloto_id]).toEqual([11, 12, 10]);
  });

  it("17) intercambio de unidades (la unidad ya existe en tms_unidades: se reutiliza sin duplicar)", async () => {
    const r = await guardar([cambio(101, { flotaVehiculoId: 31 }), cambio(102, { flotaVehiculoId: 30 })]);
    expect(r).toMatchObject({ ok: true, guardados: 2 });
    expect([p(101).unidad_tms, p(102).unidad_tms]).toEqual([301, 300]);
    expect(m.unidades).toHaveLength(2);
  });

  it("18) intercambio de TC (id + fotografía de placa)", async () => {
    const r = await guardar([cambio(101, { tcVehiculoId: 41 }), cambio(102, { tcVehiculoId: 40 })]);
    expect(r).toMatchObject({ ok: true, guardados: 2 });
    expect([p(101).tc, p(102).tc]).toEqual([41, 40]);
    const u = updates.find((x) => x.sql.includes("tc_placa_historica"))!;
    expect(u.params.slice(0, 2)).toEqual([41, "TC-41"]);
  });

  it("19) recurso final duplicado con solape: aborta TODO el lote", async () => {
    p(101).regreso = `${D0} 09:00:00`;
    const antes = snapshot();
    const r = await guardar([cambio(101, { pilotoPersonalId: 11 }), cambio(102, { pilotoPersonalId: 11 })]);
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect(codigos(r, 101)).toEqual(["RECURSO_OCUPADO_LOTE"]);
    expect(snapshot()).toBe(antes);
    expect(updates).toHaveLength(0);
  });

  it("20) recurso final duplicado SIN solape (05-08 y 08-11, borde exacto): permitido", async () => {
    const r = await guardar([cambio(101, { pilotoPersonalId: 12 }), cambio(102, { pilotoPersonalId: 12 })]);
    expect(r).toMatchObject({ ok: true, guardados: 2 });
    expect([p(101).piloto_id, p(102).piloto_id]).toEqual([12, 12]);
  });

  it("una unidad nueva de Flota sin fila en tms_unidades se crea DENTRO de la transacción, y solo tras validar todo el lote", async () => {
    const r = await guardar([cambio(101, { flotaVehiculoId: 32 })]);
    expect(r).toMatchObject({ ok: true, guardados: 1 });
    expect(m.unidades.find((u) => u.placa === "C-32")).toMatchObject({ flota: 32 });
    expect(p(101).unidad_tms).toBe(m.unidades.find((u) => u.placa === "C-32")!.id);
    expect(h.eventos.indexOf("unidad")).toBeGreaterThan(h.eventos.indexOf("forupdate-planes"));
    expect(h.eventos.indexOf("unidad")).toBeLessThan(h.eventos.indexOf("commit"));
    // con un lote inválido NO se crea la unidad (sin efectos secundarios antes de saber que todo es válido)
    m.unidades = m.unidades.filter((u) => u.placa !== "C-32"); p(101).unidad_tms = 300; h.eventos = [];
    await guardar([cambio(101, { flotaVehiculoId: 32 }), cambio(102, { pilotoPersonalId: 999 })]);
    expect(m.unidades.find((u) => u.placa === "C-32")).toBeUndefined();
    expect(h.eventos).not.toContain("unidad");
  });
});

describe("reglas por fila: cualquier fila inválida aborta TODO", () => {
  const abortaTodo = async (mutar: () => void, codigo: string, fila = 102) => {
    mutar();
    const antes = snapshot();
    const r = await guardar([cambio(101, { pilotoPersonalId: 12 }), cambio(fila, { pilotoPersonalId: fila === 102 ? 10 : 12 })]);
    expect(r, codigo).toMatchObject({ ok: false, status: 409 });
    expect(codigos(r, fila), codigo).toContain(codigo);
    expect(snapshot(), codigo).toBe(antes);
    expect(updates, codigo).toHaveLength(0);
    expect(auditorias, codigo).toHaveLength(0);
  };
  it("21/22) Cerrado y Cancelado", async () => {
    await abortaTodo(() => { p(102).estado = "Cerrado"; }, "ESTADO_NO_EDITABLE");
    await abortaTodo(() => { p(102).estado = "Cancelado"; }, "ESTADO_NO_EDITABLE");
  });
  it("23) fecha pasada", () => abortaTodo(() => { p(102).fecha = AYER; p(102).regreso = `${AYER} 11:00:00`; }, "FECHA_PASADA"));
  it("24) En ruta sin llegada: solo notas (como el PATCH)", () => abortaTodo(() => { p(102).estado = "En ruta"; }, "ESTADO_NO_EDITABLE"));
  it("25) En ruta CON llegada (pendiente de cierre) SÍ permite cambiar recursos", async () => {
    p(102).estado = "En ruta"; p(102).pendiente = true;
    const r = await guardar([cambio(102, { pilotoPersonalId: 12 })]);
    expect(r).toMatchObject({ ok: true, guardados: 1 });
    expect(p(102).piloto_id).toBe(12);
  });
  it("26) Tercerizado", () => abortaTodo(() => { p(102).tipo_viaje = "Tercerizado"; }, "TERCERIZADO_SIN_RECURSOS_INTERNOS"));
  it("27) personal inválido", () => abortaTodo(() => { personal.find((x) => x.id === 10)!.estado = "Baja"; }, "PERSONAL_INVALIDO"));
  it("28) unidad inválida en la segunda fila aborta todo", async () => {
    vi.mocked(obtenerVehiculoAccesible).mockResolvedValue(null as never);
    const antes = snapshot();
    const r = await guardar([cambio(101, { pilotoPersonalId: 12 }), cambio(102, { flotaVehiculoId: 32 })]);
    expect(codigos(r, 102)).toEqual(["UNIDAD_INVALIDA"]);
    expect(snapshot()).toBe(antes);
  });
  it("29) TC inválido", async () => {
    vi.mocked(resolverTcInterno).mockResolvedValue({ ok: false, status: 409, error: "El TC TC-99 está actualmente en taller." } as never);
    const antes = snapshot();
    const r = await guardar([cambio(101, { pilotoPersonalId: 12 }), cambio(102, { tcVehiculoId: 99 })]);
    expect(codigos(r, 102)).toEqual(["TC_INVALIDO"]);
    expect(snapshot()).toBe(antes);
  });
  it("30) incidencia bloqueante", async () => {
    vi.mocked(listarDisponibilidadPersonal).mockResolvedValue(personal.map((x) => ({
      personalId: x.id, nombre: x.nombre, incidenciasBloqueantes: x.id === 10 ? [{ tipo: "Vacaciones", fechaInicio: D0, fechaFin: D0 }] : [],
      viajeActual: null, estadoDisponibilidad: "disponible", otrosPlanesDelDia: [], advertencias: [],
    })) as never);
    await abortaTodo(() => undefined, "PERSONAL_NO_DISPONIBLE");
  });
  it("31) viático procesado al retirar a una persona", () => abortaTodo(() => { viaticos = [{ plan_id: 102, personal_id: 11, estado: "AUTORIZADO" }]; }, "VIATICO_PROCESADO"));
  it("motivo obligatorio: sin motivo no se guarda nada", async () => {
    const antes = snapshot();
    const r = await guardar([cambio(101, { pilotoPersonalId: 12 })], "   ");
    expect(codigos(r, 101)).toContain("MOTIVO_REQUERIDO");
    expect(snapshot()).toBe(antes);
  });
});

describe("recursos, auxiliares y viáticos", () => {
  it("auxiliares: el orden define al principal y auxiliar_id queda coherente con tms_plan_auxiliares (también al vaciar)", async () => {
    await guardar([cambio(101, { auxiliarPersonalIds: [21, 20] })]);
    expect([p(101).aux, p(101).auxiliar_id]).toEqual([[21, 20], 21]);
    await guardar([cambio(101, { auxiliarPersonalIds: [] })]);
    expect([p(101).aux, p(101).auxiliar_id]).toEqual([[], null]); // sin divergencia: el PATCH con COALESCE no lo permitía
    expect(vi.mocked(guardarAuxiliaresPlan)).toHaveBeenLastCalledWith(101, [], conn);
  });

  it("personal: la edición usa tms_personal.id ya existentes; NUNCA crea personal (ni antes ni después de validar)", async () => {
    await guardar([cambio(101, { pilotoPersonalId: 12, auxiliarPersonalIds: [21] })]);
    expect(personalDesdeEmpleado).not.toHaveBeenCalled();
    expect(conn.execute.mock.calls.some((c) => String(c[0]).includes("tms_personal"))).toBe(false);
  });

  it("viáticos: se sincronizan por conexión de la transacción y solo para filas donde cambia el personal", async () => {
    await guardar([cambio(101, { pilotoPersonalId: 12 }), cambio(102, { tcVehiculoId: 42 })]);
    expect(syncs).toEqual([{ planId: 101, asignacion: { piloto: 12, pilotoExtra: null, auxiliares: [20] } }]);
    expect(vi.mocked(sincronizarViaticosPlan).mock.calls[0][3]).toBe(conn);
  });

  it("UPDATE mínimo: solo las columnas que cambian, con estado en el WHERE", async () => {
    await guardar([cambio(101, { pilotoPersonalId: 12 })]);
    expect(updates[0].sql).toBe("UPDATE tms_planes_viaje SET piloto_id = ? WHERE id = ? AND empresa_id = ? AND estado = ?");
    expect(updates[0].params).toEqual([12, 101, EMP, "Programado"]);
  });

  it("quitar unidad y TC (null) escribe NULL en unidad_id, tc_vehiculo_id y tc_placa_historica", async () => {
    await guardar([cambio(101, { flotaVehiculoId: null, tcVehiculoId: null })]);
    expect(updates[0].sql).toContain("unidad_id = ?");
    expect(updates[0].params.slice(0, 3)).toEqual([null, null, null]);
    expect([p(101).unidad_tms, p(101).tc]).toEqual([null, null]);
  });
});

describe("auditoría", () => {
  it("42) una por plan realmente modificado, con el usuario de la SESIÓN, el motivo y los cambios anterior -> nuevo", async () => {
    await guardar([
      cambio(101, { pilotoPersonalId: 12, auxiliarPersonalIds: [21, 20], flotaVehiculoId: 31, tcVehiculoId: 42 }),
      cambio(102, { pilotoPersonalId: 10 }),
    ], "Cambio operativo", "jefe.ops");
    expect(auditorias.map((a) => a.usuario)).toEqual(["jefe.ops", "jefe.ops"]);
    expect(auditorias.every((a) => a.accion === "editar_ruta")).toBe(true);
    expect(auditorias[0].detalle).toBe("Plan #101 PLAN-101 · edición rápida · piloto Carlos → Luis; auxiliares [Pedro] → [Mario, Pedro]; unidad C-30 → C-31; TC TC-40 → TC-42 · motivo: Cambio operativo");
    expect(auditorias[1].detalle).toBe("Plan #102 PLAN-102 · edición rápida · piloto Juan → Carlos · motivo: Cambio operativo");
    // la bitácora del plan filtra por este prefijo
    expect(auditorias[0].detalle).toMatch(/^Plan #101 /);
  });

  it("39) no se audita ninguna fila sin cambios", async () => {
    await guardar([cambio(101), cambio(102, { pilotoPersonalId: 10 })]);
    expect(auditorias).toHaveLength(1);
    expect(auditorias[0].detalle).toContain("Plan #102");
  });
});

describe("sin cambios", () => {
  it("37) una fila sin cambios y otra modificada", async () => {
    const r = await guardar([cambio(101), cambio(102, { pilotoPersonalId: 10 })]);
    expect(r).toEqual({ ok: true, guardados: 1, filas: [{ planId: 101, estado: "sin_cambios" }, { planId: 102, estado: "guardado" }] });
    expect(updates).toHaveLength(1);
  });

  it("38) todo sin cambios: éxito con guardados 0, sin UPDATE, sin viáticos, sin personal, sin auditoría y sin COMMIT", async () => {
    const r = await guardar([cambio(101), cambio(102)]);
    expect(r).toEqual({ ok: true, guardados: 0, filas: [{ planId: 101, estado: "sin_cambios" }, { planId: 102, estado: "sin_cambios" }] });
    expect(updates).toHaveLength(0);
    expect(syncs).toHaveLength(0);
    expect(auditorias).toHaveLength(0);
    expect(personalDesdeEmpleado).not.toHaveBeenCalled();
    expect(h.eventos).not.toContain("commit");
    expect(h.eventos).toContain("unlock");
  });
});

describe("seguridad", () => {
  it("40) un plan de OTRA empresa no existe para la sesión: se aborta todo el lote", async () => {
    m.planes.push(plan(900, { empresa_id: 8, piloto_id: 10 }));
    const antes = snapshot();
    const r = await guardar([cambio(101, { pilotoPersonalId: 12 }), cambio(900, { pilotoPersonalId: 12 })]);
    expect(codigos(r, 900)).toEqual(["PLAN_NO_ENCONTRADO"]);
    expect(snapshot()).toBe(antes);
    for (const c of vi.mocked(query).mock.calls.concat(conn.query.mock.calls as never)) {
      const [sql, params] = c as [string, unknown[]];
      if (String(sql).includes("tms_planes_viaje") && (params ?? []).length) expect((params as unknown[])[0]).toBe(EMP);
    }
  });

  it("41/43/44) esquema estricto: empresaId del cliente, más de 200 filas e ids duplicados se rechazan", () => {
    const c = cambio(101);
    expect(validarEdicionRapidaSchema.safeParse({ empresaId: 9, cambios: [c] }).success).toBe(false);
    expect(validarEdicionRapidaSchema.safeParse({ cambios: Array.from({ length: 201 }, (_, i) => ({ ...c, planId: i + 1 })) }).success).toBe(false);
    expect(validarEdicionRapidaSchema.safeParse({ cambios: [c, c] }).success).toBe(false);
  });

  it("el guardado usa la empresa recibida (de la sesión) en el candado y en todas las consultas", async () => {
    await guardar([cambio(101, { pilotoPersonalId: 12 })]);
    const lock = conn.query.mock.calls.find((c) => String(c[0]).includes("GET_LOCK"))!;
    expect(lock[1]).toEqual([`tms_traslape_${EMP}`, 8]);
  });

  it("error inesperado: 500 con mensaje genérico (sin filtrar detalles) y rollback", async () => {
    conn.beginTransaction.mockRejectedValueOnce(new Error("boom interno"));
    const r = await guardar([cambio(101, { pilotoPersonalId: 12 })]);
    expect(r).toEqual({ ok: false, status: 500, error: "No se pudo guardar la edición rápida. No se modificó ningún viaje." });
    expect(h.eventos).toContain("unlock");
  });
});

describe("PILOTO EXTRA — la edición rápida lo conserva y lo tiene en cuenta (no lo edita)", () => {
  beforeEach(() => {
    personal.push(persona(33, "Extra Piloto", 300));
    p(101).extra = 33;
  });

  it("cambiar solo el piloto principal: el extra queda intacto (no se toca la tabla) y su viático se conserva en la sincronización", async () => {
    const r = await guardar([cambio(101, { pilotoPersonalId: 12 })]);
    expect(r).toMatchObject({ ok: true, guardados: 1 });
    expect(p(101).extra).toBe(33);
    expect(syncs).toEqual([{ planId: 101, asignacion: { piloto: 12, pilotoExtra: 33, auxiliares: [20] } }]);
    expect(conn.execute.mock.calls.some((c) => String(c[0]).includes("tms_plan_pilotos_adicionales"))).toBe(false);
  });

  it("no se puede poner como principal (ni como auxiliar) a quien ya es piloto extra del viaje", async () => {
    const r1 = await guardar([cambio(101, { pilotoPersonalId: 33 })]);
    expect(r1.ok).toBe(false);
    expect(codigos(r1, 101)).toEqual(["PERSONAL_INVALIDO"]);
    const r2 = await guardar([cambio(101, { auxiliarPersonalIds: [20] , pilotoPersonalId: 10 }), cambio(102, { pilotoPersonalId: 11 })]);
    expect(r2).toMatchObject({ ok: true });
  });

  it("el extra ocupa el intervalo: otro viaje solapado que quiera a esa persona choca (no se ignora en la validación)", async () => {
    // plan 102 (08:00-11:00) intenta tomar como principal a la persona que es extra del plan 101 (05:00-08:00): NO solapan → permitido
    expect((await guardar([cambio(102, { pilotoPersonalId: 33 })])).ok).toBe(true);
  });

  it("dos filas del mismo lote con ventanas solapadas: el extra de una y el nuevo principal de otra chocan", async () => {
    p(102).hora = "05:00:00"; p(102).regreso = `${D0} 07:00:00`; // solapa con el plan 101 (05:00-08:00)
    const r = await guardar([cambio(102, { pilotoPersonalId: 33 })]);
    expect(r.ok).toBe(false);
    expect((r as { filas?: { planId: number; errores: { codigo: string }[] }[] }).filas?.find((f) => f.planId === 102)?.errores.map((e) => e.codigo)).toEqual(["RECURSO_OCUPADO_BD"]);
  });

  it("los viáticos ya procesados del extra impiden retirarlo aunque se edite otra cosa: no se pierde (el extra no sale al cambiar el principal)", async () => {
    viaticos.push({ plan_id: 101, personal_id: 33, estado: "AUTORIZADO" });
    const r = await guardar([cambio(101, { pilotoPersonalId: 12 })]);
    expect(r).toMatchObject({ ok: true }); // nadie sale: el extra sigue en el viaje
  });
});
