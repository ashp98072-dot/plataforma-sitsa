import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RowDataPacket } from "mysql2";

vi.mock("@/lib/db", () => ({ query: vi.fn(), execute: vi.fn(), getPool: vi.fn() }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoriaTx: vi.fn(), registrarAuditoria: vi.fn() }));
vi.mock("./empleados-schema", () => ({ asegurarSchemaEmpleados: vi.fn(() => Promise.resolve()) }));

import { getPool, query } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import { cerrarAsistenciaDia, MARCA_ASISTENCIA_ADMINISTRATIVA, obtenerAsistenciaDia, validarFechaAsistencia } from "./asistencia-diaria";
import { obtenerReporteAsistencias } from "./reportes";

/**
 * RRHH-TOMAR-ASISTENCIA-1 — lógica real de "Tomar asistencia" sobre una base
 * EN MEMORIA que responde a las consultas reales (asistencia-diaria.ts y el
 * reporte de asistencias reportes.ts, que es quien DERIVA las faltas).
 */
const MIERCOLES = "2026-09-23";
const DOMINGO = "2026-09-20";
const HOY = "2026-09-23";

type Emp = { id: number; empresa_id: number; codigo: string; nombre: string; puesto: string; estado: string; fecha_alta: string; fecha_egreso: string | null; tipo_horario: string; hora_entrada_teorica: string | null; hora_salida_teorica: string | null };
type Ses = { id: number; empresa_id: number; id_empleado: number; fecha_jornada: string; entrada_at: string; salida_at: string | null; estado: string; comentarios_rrhh: string | null };
type Inc = { id: number; empresa_id: number; id_empleado: number; tipo: string; fecha_inicio: string; fecha_fin: string };

let empleados: Emp[] = [];
let sesiones: Ses[] = [];
let incidencias: Inc[] = [];
let enRuta: { empresa_id: number; id_empleado: number; fecha_inicio: string; fecha_fin: string }[] = [];
let feriados: { empresa_id: number; fecha: string }[] = [];
let inserts: unknown[][] = [];
type Aus = { id: number; empresa_id: number; empleado_id: number; fecha: string; estado: string; planilla_periodo_id: number | null; confirmado_por: string; anulado_por?: string };
let ausencias: Aus[] = [];
let cierres: { empresa_id: number; fecha: string; cerrado_por: string; actualizado_por?: string; presentes: number; ausentes: number; justificados: number }[] = [];
let periodos: { empresa_id: number; codigo: string; estado: string; fecha_inicio: string; fecha_fin: string; autorizado_en: string | null }[] = [];
let sinMigracion = false;
const errTabla = () => Object.assign(new Error("Table doesn't exist"), { code: "ER_NO_SUCH_TABLE", errno: 1146 });
let ejecuciones: string[] = [];
let lockResultado = 1;
let fallarInsert = false;
let conexion: ReturnType<typeof crearConexion>;
const consultas: { sql: string; params: unknown[] }[] = [];

const emp = (id: number, over: Partial<Emp> = {}): Emp => ({
  id, empresa_id: 7, codigo: `E${id}`, nombre: `Empleado ${id}`, puesto: "Piloto", estado: "Activo", fecha_alta: "2020-01-01", fecha_egreso: null,
  tipo_horario: "Fijo", hora_entrada_teorica: "07:00:00", hora_salida_teorica: "16:00:00", ...over,
});

function emular(sql: string, paramsIn?: unknown[]): RowDataPacket[] {
  const s = String(sql);
  const params = paramsIn ?? [];
  consultas.push({ sql: s, params });
  const [e, a, b] = params as [number, string, string];
  if (s.includes("rrhh_asistencia_") && sinMigracion) throw errTabla();
  if (s.includes("SELECT 1 FROM rrhh_asistencia_")) return [] as never;
  if (s.includes("FROM rrhh_asistencia_ausencias")) return ausencias.filter((x) => x.empresa_id === e && x.fecha === a) as never;
  if (s.includes("FROM rrhh_asistencia_cierres")) return cierres.filter((x) => x.empresa_id === e && x.fecha === a) as never;
  if (s.includes("FROM rrhh_planilla_periodos")) {
    return periodos.filter((x) => x.empresa_id === e && x.fecha_inicio <= a && x.fecha_fin >= a && x.estado !== "Cancelado"
      && (["Cerrada", "Pagada"].includes(x.estado) || x.autorizado_en != null)) as never;
  }
  if (s.includes("FROM sesiones_trabajo s") && s.includes("JOIN empleados")) {
    const [ini, fin] = [params[2] as string, params[3] as string];
    return sesiones.filter((x) => x.empresa_id === e && x.fecha_jornada >= ini && x.fecha_jornada <= fin)
      .map((x) => { const m = empleados.find((y) => y.id === x.id_empleado)!; return { ...x, codigo: m.codigo, nombre: m.nombre, hora_entrada_teorica: m.hora_entrada_teorica, hora_salida_teorica: m.hora_salida_teorica, tipo_horario: m.tipo_horario, foto_entrada_id: null, foto_salida_id: null }; }) as never;
  }
  if (s.includes("SELECT id, codigo, nombre, fecha_alta")) {
    return empleados.filter((x) => x.empresa_id === e && x.estado === "Activo") as never;
  }
  if (s.includes("FROM empleados WHERE empresa_id = ? AND estado = 'Activo'")) {
    return empleados.filter((x) => x.empresa_id === e && x.estado === "Activo") as never;
  }
  if (s.includes("DISTINCT id_empleado FROM sesiones_trabajo")) {
    return sesiones.filter((x) => x.empresa_id === e && x.fecha_jornada < a && x.salida_at && x.salida_at.slice(0, 10) >= b).map((x) => ({ id_empleado: x.id_empleado })) as never;
  }
  if (s.includes("FROM sesiones_trabajo WHERE empresa_id = ? AND fecha_jornada = ?")) {
    return sesiones.filter((x) => x.empresa_id === e && x.fecha_jornada === a) as never;
  }
  if (s.includes("SELECT id_empleado, tipo FROM incidencias")) {
    return incidencias.filter((x) => x.empresa_id === e && x.fecha_inicio <= a && x.fecha_fin >= a) as never;
  }
  if (s.includes("FROM incidencias") && s.includes("fecha_fin >= ?")) {
    return incidencias.filter((x) => x.empresa_id === e && x.fecha_fin >= a && x.fecha_inicio <= b) as never;
  }
  if (s.includes("FROM marcajes_en_ruta")) {
    if (s.includes("SELECT id_empleado, fecha_inicio")) return enRuta.filter((x) => x.empresa_id === e && x.fecha_fin >= a && x.fecha_inicio <= b) as never;
    return enRuta.filter((x) => x.empresa_id === e && x.fecha_inicio <= a && x.fecha_fin >= a) as never;
  }
  if (s.includes("FROM feriados")) return feriados.filter((x) => x.empresa_id === e && x.fecha >= a && x.fecha <= b) as never;
  return [] as never; // configuracion (tolerancia) y demás: valores por defecto
}

function crearConexion() {
  return {
    beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(),
    query: vi.fn(async (sql: string) => {
      ejecuciones.push(String(sql));
      if (String(sql).includes("GET_LOCK")) return [[{ l: lockResultado }]];
      return [[]];
    }),
    execute: vi.fn(async (sql: string, params: unknown[]) => {
      if (String(sql).includes("INSERT INTO sesiones_trabajo")) {
        if (fallarInsert) throw new Error("fallo de BD");
        inserts.push(params);
        const [emp_, idEmp, fecha, entrada, salida, comentarios] = params as [number, number, string, string, string, string];
        sesiones.push({ id: 1000 + inserts.length, empresa_id: emp_, id_empleado: idEmp, fecha_jornada: fecha, entrada_at: entrada, salida_at: salida, estado: "CERRADA", comentarios_rrhh: comentarios });
      }
      if (String(sql).includes("INSERT IGNORE INTO rrhh_asistencia_ausencias")) {
        const [emp_, idEmp, fecha, por] = params as [number, number, string, string];
        if (ausencias.some((x) => x.empresa_id === emp_ && x.empleado_id === idEmp && x.fecha === fecha)) return [{ affectedRows: 0 }];
        ausencias.push({ id: ausencias.length + 1, empresa_id: emp_, empleado_id: idEmp, fecha, estado: "CONFIRMADA", planilla_periodo_id: null, confirmado_por: por });
        return [{ affectedRows: 1 }];
      }
      if (String(sql).includes("UPDATE rrhh_asistencia_ausencias")) {
        const [por, emp_, idEmp, fecha] = params as [string, number, number, string];
        const a = ausencias.find((x) => x.empresa_id === emp_ && x.empleado_id === idEmp && x.fecha === fecha && x.estado === "CONFIRMADA" && x.planilla_periodo_id == null);
        if (!a) return [{ affectedRows: 0 }];
        a.estado = "ANULADA"; a.anulado_por = por;
        return [{ affectedRows: 1 }];
      }
      if (String(sql).includes("INSERT INTO rrhh_asistencia_cierres")) {
        const [emp_, fecha, por, presentes, ausentes, justificados] = params as [number, string, string, number, number, number];
        const previo = cierres.find((x) => x.empresa_id === emp_ && x.fecha === fecha);
        if (previo) Object.assign(previo, { actualizado_por: por, presentes, ausentes, justificados });
        else cierres.push({ empresa_id: emp_, fecha, cerrado_por: por, presentes, ausentes, justificados });
        return [{ affectedRows: 1 }];
      }
      return [{ insertId: 1, affectedRows: 1 }];
    }),
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  consultas.length = 0;
  empleados = []; sesiones = []; incidencias = []; enRuta = []; feriados = []; inserts = []; ejecuciones = [];
  ausencias = []; cierres = []; periodos = []; sinMigracion = false;
  lockResultado = 1; fallarInsert = false;
  conexion = crearConexion();
  vi.mocked(getPool).mockReturnValue({ getConnection: vi.fn().mockResolvedValue(conexion) } as never);
  vi.mocked(query).mockImplementation((async (sql: string, params: unknown[]) => emular(sql, params)) as never);
});

const cerrar = (ids: number[], fecha = MIERCOLES, empresa = 7) => cerrarAsistenciaDia(empresa, { fecha, empleadoIds: ids, usuario: "rrhh1", hoy: HOY });
const estadoDe = async (id: number, fecha = MIERCOLES) => (await obtenerAsistenciaDia(7, fecha)).empleados.find((e) => e.id === id);

describe("lista: solo empleados elegibles y estado real del día", () => {
  it("lista los ACTIVOS de la empresa; una Baja nunca aparece", async () => {
    empleados = [emp(1), emp(2, { estado: "Baja" })];
    const dia = await obtenerAsistenciaDia(7, MIERCOLES);
    expect(dia.empleados.map((e) => e.id)).toEqual([1]);
    expect(consultas.find((c) => c.sql.includes("FROM empleados"))!.sql).toContain("estado = 'Activo'");
  });

  it("trae código, nombre, puesto y el horario INDIVIDUAL del empleado", async () => {
    empleados = [emp(1, { hora_entrada_teorica: "06:30:00", hora_salida_teorica: "15:30:00", puesto: "Auxiliar" })];
    const [e] = (await obtenerAsistenciaDia(7, MIERCOLES)).empleados;
    expect(e).toMatchObject({ codigo: "E1", nombre: "Empleado 1", puesto: "Auxiliar", estado: "Pendiente", seleccionable: true, marcado: false });
    expect(e.horario).toEqual({ tipo: "Fijo", entrada: "06:30:00", salida: "15:30:00" });
  });

  it("sin registro y día laborable -> Pendiente (seleccionable)", async () => {
    empleados = [emp(1)];
    expect((await estadoDe(1))!.estado).toBe("Pendiente");
  });

  it("marcaje real cerrado -> Presente (✓ bloqueado); jornada abierta -> Marcaje existente (bloqueado)", async () => {
    empleados = [emp(1), emp(2)];
    sesiones = [
      { id: 1, empresa_id: 7, id_empleado: 1, fecha_jornada: MIERCOLES, entrada_at: `${MIERCOLES} 07:12:00`, salida_at: `${MIERCOLES} 16:10:00`, estado: "CERRADA", comentarios_rrhh: null },
      { id: 2, empresa_id: 7, id_empleado: 2, fecha_jornada: MIERCOLES, entrada_at: `${MIERCOLES} 07:00:00`, salida_at: null, estado: "ABIERTA", comentarios_rrhh: null },
    ];
    const uno = (await estadoDe(1))!;
    const dos = (await estadoDe(2))!;
    expect([uno.estado, uno.marcado, uno.seleccionable]).toEqual(["Presente", true, false]);
    expect(uno.detalle).toContain("07:12 – 16:10");
    expect([dos.estado, dos.marcado, dos.seleccionable]).toEqual(["Marcaje existente", true, false]);
  });

  it("vacaciones -> Vacaciones; permiso/incidencia -> Justificado; ninguno seleccionable", async () => {
    empleados = [emp(1), emp(2)];
    incidencias = [
      { id: 1, empresa_id: 7, id_empleado: 1, tipo: "Vacaciones", fecha_inicio: "2026-09-21", fecha_fin: "2026-09-25" },
      { id: 2, empresa_id: 7, id_empleado: 2, tipo: "Permiso médico", fecha_inicio: MIERCOLES, fecha_fin: MIERCOLES },
    ];
    expect((await estadoDe(1))).toMatchObject({ estado: "Vacaciones", seleccionable: false });
    expect((await estadoDe(2))).toMatchObject({ estado: "Justificado", detalle: "Permiso médico", seleccionable: false });
  });

  it("en ruta (marcajes_en_ruta o viaje multi-día) -> En ruta, no seleccionable (regla existente respetada)", async () => {
    empleados = [emp(1), emp(2)];
    enRuta = [{ empresa_id: 7, id_empleado: 1, fecha_inicio: "2026-09-22", fecha_fin: "2026-09-24" }];
    sesiones = [{ id: 5, empresa_id: 7, id_empleado: 2, fecha_jornada: "2026-09-22", entrada_at: "2026-09-22 07:00:00", salida_at: `${MIERCOLES} 18:00:00`, estado: "CERRADA", comentarios_rrhh: null }];
    expect((await estadoDe(1))!.estado).toBe("En ruta");
    expect((await estadoDe(2))!.estado).toBe("En ruta");
  });

  it("domingo -> No aplica para todos (día de descanso); feriado configurado -> No aplica", async () => {
    empleados = [emp(1)];
    expect(await estadoDe(1, DOMINGO)).toMatchObject({ estado: "No aplica", detalle: "Domingo", seleccionable: false });
    feriados = [{ empresa_id: 7, fecha: MIERCOLES }];
    expect(await estadoDe(1)).toMatchObject({ estado: "No aplica", detalle: "Feriado", seleccionable: false });
    expect((await obtenerAsistenciaDia(7, DOMINGO)).laborable).toBe(false);
  });

  it("horario Variable -> 'Requiere registro manual' (no se procesa) ; Fijo sin horas teóricas también", async () => {
    empleados = [emp(1, { tipo_horario: "Variable" }), emp(2, { hora_entrada_teorica: null }), emp(3)];
    expect(await estadoDe(1)).toMatchObject({ estado: "Requiere registro manual", seleccionable: false, horario: { tipo: "Variable", entrada: null, salida: null } });
    expect(await estadoDe(2)).toMatchObject({ estado: "Requiere registro manual", seleccionable: false });
    expect((await estadoDe(3))!.seleccionable).toBe(true);
  });

  it("nunca antes de la contratación ni después del egreso (fecha histórica dentro de la relación laboral sí)", async () => {
    empleados = [emp(1, { fecha_alta: "2026-09-25" }), emp(2, { fecha_egreso: "2026-09-10" }), emp(3, { fecha_alta: "2026-09-01" })];
    expect((await obtenerAsistenciaDia(7, MIERCOLES)).empleados.map((e) => e.id)).toEqual([3]);
    expect((await obtenerAsistenciaDia(7, "2026-09-09")).empleados.map((e) => e.id).sort()).toEqual([2, 3]);
  });

  it("aislamiento por empresa: solo los empleados de la empresa de la sesión, y todas las consultas van acotadas por ella", async () => {
    empleados = [emp(1), emp(9, { empresa_id: 8 })];
    const dia = await obtenerAsistenciaDia(7, MIERCOLES);
    expect(dia.empleados.map((e) => e.id)).toEqual([1]);
    expect(consultas.every((c) => c.params[0] === 7)).toBe(true);
  });

  it("solo leer la lista NO escribe nada (un checkbox sin cerrar no crea jornada ni falta)", async () => {
    empleados = [emp(1)];
    await obtenerAsistenciaDia(7, MIERCOLES);
    expect(inserts).toEqual([]);
    expect(conexion.execute).not.toHaveBeenCalled();
  });
});

describe("fecha: histórica sí, futura no", () => {
  it("validarFechaAsistencia: hoy y pasadas OK; futura e inválidas rechazadas", () => {
    expect(validarFechaAsistencia("2026-09-23", HOY)).toBeNull();
    expect(validarFechaAsistencia("2026-01-05", HOY)).toBeNull();
    expect(validarFechaAsistencia("2026-09-24", HOY)).toContain("futura");
    expect(validarFechaAsistencia("2026-02-30", HOY)).toContain("inválida");
    expect(validarFechaAsistencia("23/09/2026", HOY)).toContain("inválida");
  });

  it("cerrar una fecha futura -> 400 y no toca la base", async () => {
    empleados = [emp(1)];
    const r = await cerrar([1], "2026-09-24");
    expect(r).toMatchObject({ ok: false, status: 400 });
    expect(getPool).not.toHaveBeenCalled();
    expect(inserts).toEqual([]);
  });

  it("cerrar una fecha histórica funciona", async () => {
    empleados = [emp(1)];
    const r = await cerrar([1], "2026-09-16");
    expect(r).toMatchObject({ ok: true, creados: 1 });
    expect(inserts[0][2]).toBe("2026-09-16");
  });
});

describe("cerrar asistencia: checkbox presente crea la jornada correcta", () => {
  it("entrada/salida = horario teórico INDIVIDUAL de cada empleado, estado CERRADA, marcada como ASISTENCIA ADMINISTRATIVA, sin GPS/foto/evidencia", async () => {
    empleados = [emp(1), emp(2, { hora_entrada_teorica: "06:00:00", hora_salida_teorica: "14:00:00" })];
    const r = await cerrar([1, 2]);
    expect(r).toMatchObject({ ok: true, creados: 2 });
    expect(inserts[0]).toEqual([7, 1, MIERCOLES, `${MIERCOLES} 07:00:00`, `${MIERCOLES} 16:00:00`, expect.stringContaining(MARCA_ASISTENCIA_ADMINISTRATIVA)]);
    expect(inserts[1].slice(3, 5)).toEqual([`${MIERCOLES} 06:00:00`, `${MIERCOLES} 14:00:00`]);
    expect(String(inserts[0][5])).toContain("rrhh1");
    const sql = conexion.execute.mock.calls[0][0] as string;
    expect(sql).toContain("'CERRADA'");
    expect(sql).not.toMatch(/lat|lng|ubicacion|foto|evidencia/i);
  });

  it("no guarda por cada clic: hasta cerrar no hay INSERT; el candado y la transacción rodean todo el cierre", async () => {
    empleados = [emp(1)];
    await cerrar([1]);
    expect(conexion.beginTransaction).toHaveBeenCalledTimes(1);
    expect(conexion.commit).toHaveBeenCalledTimes(1);
    expect(ejecuciones.some((s) => s.includes("GET_LOCK"))).toBe(true);
    expect(ejecuciones.some((s) => s.includes("RELEASE_LOCK"))).toBe(true);
    expect(conexion.release).toHaveBeenCalled();
  });

  it("un marcaje real existente NO se sustituye por el horario teórico (07:12 / 16:10 se conserva)", async () => {
    empleados = [emp(1)];
    sesiones = [{ id: 1, empresa_id: 7, id_empleado: 1, fecha_jornada: MIERCOLES, entrada_at: `${MIERCOLES} 07:12:00`, salida_at: `${MIERCOLES} 16:10:00`, estado: "CERRADA", comentarios_rrhh: null }];
    const r = await cerrar([1]);
    expect(r).toMatchObject({ ok: true, creados: 0, yaRegistrados: 1 });
    expect(inserts).toEqual([]);
    expect(sesiones[0].entrada_at).toBe(`${MIERCOLES} 07:12:00`);
    expect(sesiones).toHaveLength(1);
  });

  it("aunque el cliente mande a un empleado no elegible (vacaciones, Variable, no aplica, otra empresa), el servidor NO crea su jornada", async () => {
    empleados = [emp(1), emp(2, { tipo_horario: "Variable" }), emp(3), emp(9, { empresa_id: 8 })];
    incidencias = [{ id: 1, empresa_id: 7, id_empleado: 3, tipo: "Vacaciones", fecha_inicio: MIERCOLES, fecha_fin: MIERCOLES }];
    const r = await cerrar([1, 2, 3, 9, 12345]);
    expect(r).toMatchObject({ ok: true, creados: 1 });
    expect(inserts.map((i) => i[1])).toEqual([1]);
    expect(r.ok && r.omitidos.map((o) => o.empleadoId).sort((a, b) => a - b)).toEqual([2, 3, 9, 12345]);
  });

  it("tenant: empresa de la sesión — nunca crea jornadas en otra empresa", async () => {
    empleados = [emp(1), emp(9, { empresa_id: 8 })];
    await cerrar([1, 9]);
    expect(inserts.every((i) => i[0] === 7)).toBe(true);
    expect(sesiones.filter((s) => s.empresa_id === 8)).toEqual([]);
  });

  it("registra en auditoría quién confirmó, la fecha y los empleados (una sola entrada por cierre, en la misma transacción)", async () => {
    empleados = [emp(1), emp(2)];
    await cerrar([1, 2]);
    expect(registrarAuditoriaTx).toHaveBeenCalledTimes(1);
    const [conn, entrada] = vi.mocked(registrarAuditoriaTx).mock.calls[0];
    expect(conn).toBe(conexion);
    expect(entrada).toMatchObject({ empresaId: 7, usuario: "rrhh1", accion: "asistencia_administrativa", modulo: "rrhh" });
    expect(entrada.detalle).toContain(MIERCOLES);
    expect(entrada.detalle).toContain("E1, E2");
  });

  it("sin nada que crear ni confirmar, el cierre igual se persiste pero no hay auditoría ni jornadas ni ausencias", async () => {
    empleados = [emp(1)];
    incidencias = [{ id: 1, empresa_id: 7, id_empleado: 1, tipo: "Vacaciones", fecha_inicio: MIERCOLES, fecha_fin: MIERCOLES }];
    await cerrar([]);
    expect(cierres).toHaveLength(1);
    expect(inserts).toEqual([]);
    expect(ausencias).toEqual([]);
    expect(registrarAuditoriaTx).not.toHaveBeenCalled();
  });

  it("si falla el INSERT: rollback, sin auditoría y sin dejar el candado tomado", async () => {
    empleados = [emp(1)];
    fallarInsert = true;
    await expect(cerrar([1])).rejects.toThrow("fallo de BD");
    expect(conexion.rollback).toHaveBeenCalled();
    expect(conexion.commit).not.toHaveBeenCalled();
    expect(registrarAuditoriaTx).not.toHaveBeenCalled();
    expect(ejecuciones.some((s) => s.includes("RELEASE_LOCK"))).toBe(true);
    expect(conexion.release).toHaveBeenCalled();
  });
});

describe("cierre del día: resumen, ausentes e idempotencia", () => {
  it("procesa a los no marcados: quedan como Ausentes SIN escribir ninguna 'falta' (la falta se deriva de la ausencia de sesión)", async () => {
    empleados = [emp(1), emp(2), emp(3), emp(4)];
    incidencias = [
      { id: 1, empresa_id: 7, id_empleado: 3, tipo: "Vacaciones", fecha_inicio: MIERCOLES, fecha_fin: MIERCOLES },
      { id: 2, empresa_id: 7, id_empleado: 4, tipo: "Permiso", fecha_inicio: MIERCOLES, fecha_fin: MIERCOLES },
    ];
    const r = await cerrar([1]);
    expect(r).toMatchObject({ ok: true, creados: 1 });
    expect(r.ok && r.resumen).toEqual({ presentes: 1, vacaciones: 1, permisos: 1, enRuta: 0, noAplica: 0, requiereManual: 0, ausentes: 1 });
    expect(r.ok && r.ausentes.map((a) => a.id)).toEqual([2]);
    expect(inserts).toHaveLength(1); // una sola jornada (la del presente)
    // La ausencia queda CONFIRMADA solo para el elegible no marcado (no para vacaciones/permiso).
    expect(ausencias.map((a) => [a.empleado_id, a.estado, a.confirmado_por])).toEqual([[2, "CONFIRMADA", "rrhh1"]]);
    expect(cierres).toEqual([expect.objectContaining({ fecha: MIERCOLES, cerrado_por: "rrhh1", presentes: 1, ausentes: 1, justificados: 2 })]);
  });

  it("idempotente: cerrar dos veces NO duplica jornadas (la 2ª crea 0 y reporta yaRegistrados)", async () => {
    empleados = [emp(1), emp(2)];
    await cerrar([1, 2]);
    const segunda = await cerrar([1, 2]);
    expect(segunda).toMatchObject({ ok: true, creados: 0, yaRegistrados: 2 });
    expect(sesiones).toHaveLength(2);
    expect(inserts).toHaveLength(2);
  });

  it("doble cierre no duplica ausencias ni cierres (UNIQUE + INSERT IGNORE): 1 ausencia, 1 cierre", async () => {
    empleados = [emp(1), emp(2)];
    const primera = await cerrar([1]);
    const segunda = await cerrar([1]);
    expect(primera).toMatchObject({ ok: true, creados: 1, ausenciasConfirmadas: 1 });
    expect(segunda).toMatchObject({ ok: true, creados: 0, ausenciasConfirmadas: 0 });
    expect(ausencias).toHaveLength(1);
    expect(cierres).toHaveLength(1);
    expect(cierres[0].actualizado_por).toBe("rrhh1");
    expect(registrarAuditoriaTx).toHaveBeenCalledTimes(1); // el 2º cierre no cambió nada
  });

  it("candado por empresa+fecha: si otro cierre está en curso -> 409 y no crea nada", async () => {
    empleados = [emp(1)];
    lockResultado = 0;
    const r = await cerrar([1]);
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect(inserts).toEqual([]);
    expect(ejecuciones.some((s) => s.includes("RELEASE_LOCK"))).toBe(false); // no se libera un candado que no se tomó
  });

  it("la clave del candado incluye empresa y fecha (cierres de otra fecha/empresa no se bloquean entre sí)", async () => {
    empleados = [emp(1)];
    await cerrar([1]);
    const lock = conexion.query.mock.calls.find(([s]) => String(s).includes("GET_LOCK"))!;
    expect((lock as unknown[])[1]).toEqual([`rrhh_asistencia_7_${MIERCOLES}`]);
  });
});

describe("ausencia confirmada por RRHH (persistida al cerrar)", () => {
  it("ANTES del cierre no hay ausencia confirmada ni cierre: quien no está marcado es solo Pendiente", async () => {
    empleados = [emp(1), emp(2)];
    const dia = await obtenerAsistenciaDia(7, MIERCOLES);
    expect(dia.cierre).toBeNull();
    expect(dia.empleados.map((e) => e.estado)).toEqual(["Pendiente", "Pendiente"]);
    expect(ausencias).toEqual([]);
    expect(cierres).toEqual([]);
  });

  it("al cerrar: el no marcado queda Ausente (CONFIRMADA por RRHH) y el día queda cerrado", async () => {
    empleados = [emp(1), emp(2)];
    await cerrar([1]);
    const dia = await obtenerAsistenciaDia(7, MIERCOLES);
    expect(dia.cierre).toMatchObject({ cerradoPor: "rrhh1" });
    expect(dia.empleados.find((e) => e.id === 2)).toMatchObject({ estado: "Ausente", detalle: "Falta confirmada por RRHH", seleccionable: true, marcado: false });
    expect(dia.empleados.find((e) => e.id === 1)).toMatchObject({ estado: "Presente", marcado: true });
  });

  it("vacaciones, permiso, en ruta, viaje, Variable y sin horario NUNCA generan ausencia", async () => {
    empleados = [emp(1), emp(2), emp(3), emp(4, { tipo_horario: "Variable" }), emp(5, { hora_entrada_teorica: null }), emp(6)];
    incidencias = [
      { id: 1, empresa_id: 7, id_empleado: 1, tipo: "Vacaciones", fecha_inicio: MIERCOLES, fecha_fin: MIERCOLES },
      { id: 2, empresa_id: 7, id_empleado: 2, tipo: "Permiso con goce", fecha_inicio: MIERCOLES, fecha_fin: MIERCOLES },
    ];
    enRuta = [{ empresa_id: 7, id_empleado: 3, fecha_inicio: MIERCOLES, fecha_fin: MIERCOLES }];
    await cerrar([]);
    expect(ausencias.map((a) => a.empleado_id)).toEqual([6]);
  });

  it("domingo y feriado: no se puede cerrar (400) y no se escribe ninguna ausencia ni cierre", async () => {
    empleados = [emp(1)];
    expect(await cerrar([], DOMINGO)).toMatchObject({ ok: false, status: 400 });
    feriados = [{ empresa_id: 7, fecha: MIERCOLES }];
    expect(await cerrar([])).toMatchObject({ ok: false, status: 400 });
    expect(ausencias).toEqual([]);
    expect(cierres).toEqual([]);
  });

  it("fuera de la relación laboral (antes del alta / después del egreso) no genera ausencia", async () => {
    empleados = [emp(1, { fecha_alta: "2026-09-25" }), emp(2, { fecha_egreso: "2026-09-10" }), emp(3)];
    await cerrar([]);
    expect(ausencias.map((a) => a.empleado_id)).toEqual([3]);
  });

  it("CORRECCIÓN: marcar a un Ausente y volver a cerrar crea la jornada y ANULA la ausencia (no se borra)", async () => {
    empleados = [emp(1)];
    await cerrar([]);
    expect(ausencias[0].estado).toBe("CONFIRMADA");
    const r = await cerrar([1]);
    expect(r).toMatchObject({ ok: true, creados: 1, ausenciasAnuladas: 1 });
    expect(ausencias).toHaveLength(1);
    expect(ausencias[0]).toMatchObject({ estado: "ANULADA", anulado_por: "rrhh1" });
    expect((await estadoDe(1))!.estado).toBe("Presente");
    expect(String(vi.mocked(registrarAuditoriaTx).mock.calls.at(-1)?.[1].detalle)).toContain("1 ausencia(s) anulada(s)");
  });

  it("una ANULADA no se re-confirma sola: cerrar otra vez sin marcarla no la vuelve a CONFIRMADA", async () => {
    empleados = [emp(1)];
    ausencias = [{ id: 1, empresa_id: 7, empleado_id: 1, fecha: MIERCOLES, estado: "ANULADA", planilla_periodo_id: null, confirmado_por: "rrhh1" }];
    await cerrar([]);
    expect(ausencias).toHaveLength(1);
    expect(ausencias[0].estado).toBe("ANULADA");
  });

  it("ausencia ya descontada en una planilla: no es corregible (seleccionable=false) y el servidor no la anula", async () => {
    empleados = [emp(1)];
    ausencias = [{ id: 1, empresa_id: 7, empleado_id: 1, fecha: MIERCOLES, estado: "CONFIRMADA", planilla_periodo_id: 5, confirmado_por: "rrhh1" }];
    const e = (await estadoDe(1))!;
    expect(e).toMatchObject({ estado: "Ausente", seleccionable: false });
    expect(e.detalle).toContain("descontada en planilla");
    const r = await cerrar([1]);
    expect(r).toMatchObject({ ok: true, creados: 0, ausenciasAnuladas: 0 });
    expect(ausencias[0].estado).toBe("CONFIRMADA");
    expect(inserts).toEqual([]);
  });

  it("si la ausencia quedó usada por una planilla justo antes de anular: falla y hace rollback (sin jornada)", async () => {
    empleados = [emp(1)];
    ausencias = [{ id: 1, empresa_id: 7, empleado_id: 1, fecha: MIERCOLES, estado: "CONFIRMADA", planilla_periodo_id: null, confirmado_por: "rrhh1" }];
    const original = conexion.execute.getMockImplementation()!;
    conexion.execute.mockImplementation(async (sql: string, params: unknown[]) => {
      if (String(sql).includes("UPDATE rrhh_asistencia_ausencias")) return [{ affectedRows: 0 }];
      return original(sql, params);
    });
    await expect(cerrar([1])).rejects.toThrow("planilla");
    expect(conexion.rollback).toHaveBeenCalled();
  });
});

describe("planillas cerradas: fechas bloqueadas", () => {
  const per = (estado: string, autorizado = false) => ({ empresa_id: 7, codigo: "2026-09-Q2", estado, fecha_inicio: "2026-09-16", fecha_fin: "2026-09-30", autorizado_en: autorizado ? "2026-09-30 10:00:00" : null });

  it.each([["Cerrada"], ["Pagada"]])("fecha dentro de una planilla %s: GET informa el bloqueo, nada es seleccionable y cerrar -> 409 sin escribir", async (estado) => {
    empleados = [emp(1)];
    periodos = [per(estado)];
    const dia = await obtenerAsistenciaDia(7, MIERCOLES);
    expect(dia.bloqueo).toContain("flujo de reapertura/corrección de planilla");
    expect(dia.bloqueo).toContain("2026-09-Q2");
    expect(dia.empleados.every((e) => !e.seleccionable)).toBe(true);
    const r = await cerrar([1]);
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect(!r.ok && r.error).toContain("reapertura");
    expect(inserts).toEqual([]);
    expect(ausencias).toEqual([]);
    expect(cierres).toEqual([]);
    expect(conexion.beginTransaction).not.toHaveBeenCalled();
  });

  it("una planilla autorizada (autorizado_en) también bloquea aunque su estado no diga Cerrada", async () => {
    periodos = [per("Generada", true)];
    expect((await obtenerAsistenciaDia(7, MIERCOLES)).bloqueo).not.toBeNull();
  });

  it("Borrador/Generada sin autorizar, Cancelado, otra empresa u otras fechas NO bloquean", async () => {
    empleados = [emp(1)];
    periodos = [per("Generada"), per("Borrador"), { ...per("Cerrada"), estado: "Cancelado" }, { ...per("Cerrada"), empresa_id: 8 }, { ...per("Cerrada"), fecha_inicio: "2026-09-01", fecha_fin: "2026-09-15" }];
    expect((await obtenerAsistenciaDia(7, MIERCOLES)).bloqueo).toBeNull();
    expect(await cerrar([1])).toMatchObject({ ok: true, creados: 1 });
  });
});

describe("migración de asistencia aún no aplicada", () => {
  it("la lista sigue funcionando (sin cierre ni ausencias) y cerrar responde 409 SIN escribir nada", async () => {
    empleados = [emp(1)];
    sinMigracion = true;
    const dia = await obtenerAsistenciaDia(7, MIERCOLES);
    expect(dia.cierre).toBeNull();
    expect(dia.empleados[0].estado).toBe("Pendiente");
    const r = await cerrar([1]);
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect(!r.ok && r.error).toContain("migración");
    expect(getPool).not.toHaveBeenCalled();
    expect(inserts).toEqual([]);
  });
});

describe("integración con la fuente de verdad: el reporte de asistencias (quien deriva presentes/faltas)", () => {
  const fila = async (id: number) => (await obtenerReporteAsistencias(7, MIERCOLES, MIERCOLES)).find((f) => f.codigo === `E${id}`)!;

  it("presente por checkbox -> el reporte lo considera presente: entrada A TIEMPO y salida COMPLETA (sin tardanza ni salida temprana)", async () => {
    empleados = [emp(1)];
    await cerrar([1]);
    const f = await fila(1);
    expect(f.estadoEntrada).toBe("A tiempo");
    expect(f.estadoSalida).toBe("Completa");
    expect(f.horaEntrada).toBe("07:00:00");
    expect(f.horaSalida).toBe("16:00:00");
    expect(f.comentarios).toContain(MARCA_ASISTENCIA_ADMINISTRATIVA);
  });

  it("usa el horario individual también para el reporte: 06:00-14:00 sigue siendo A tiempo / Completa", async () => {
    empleados = [emp(1, { hora_entrada_teorica: "06:00:00", hora_salida_teorica: "14:00:00" })];
    await cerrar([1]);
    const f = await fila(1);
    expect([f.estadoEntrada, f.estadoSalida]).toEqual(["A tiempo", "Completa"]);
  });

  it("ausente sin justificación (no marcado) -> el reporte lo considera FALTA", async () => {
    empleados = [emp(1), emp(2)];
    await cerrar([1]);
    expect((await fila(2)).estadoEntrada).toBe("Falta");
  });

  it("antes de cerrar, un no marcado ya figura como Falta en el reporte y un marcado por kiosco como presente: cerrar NO cambia a quien ya marcó", async () => {
    empleados = [emp(1)];
    sesiones = [{ id: 1, empresa_id: 7, id_empleado: 1, fecha_jornada: MIERCOLES, entrada_at: `${MIERCOLES} 07:12:00`, salida_at: `${MIERCOLES} 16:10:00`, estado: "CERRADA", comentarios_rrhh: null }];
    await cerrar([1]);
    const f = await fila(1);
    expect(f.horaEntrada).toBe("07:12:00");
    expect(f.estadoEntrada).toBe("Retraso");
  });

  it("vacaciones -> NO es falta (el reporte muestra la incidencia)", async () => {
    empleados = [emp(1)];
    incidencias = [{ id: 1, empresa_id: 7, id_empleado: 1, tipo: "Vacaciones", fecha_inicio: MIERCOLES, fecha_fin: MIERCOLES }];
    await cerrar([1]); // aunque se marque, no es elegible
    const f = await fila(1);
    expect(f.estadoEntrada).toBe("Vacaciones");
    expect(f.estadoEntrada).not.toBe("Falta");
    expect(inserts).toEqual([]);
  });

  it("permiso -> NO es falta", async () => {
    empleados = [emp(1)];
    incidencias = [{ id: 1, empresa_id: 7, id_empleado: 1, tipo: "Permiso", fecha_inicio: MIERCOLES, fecha_fin: MIERCOLES }];
    await cerrar([]);
    expect((await fila(1)).estadoEntrada).toBe("Permiso");
  });

  it("en ruta -> NO es falta", async () => {
    empleados = [emp(1)];
    enRuta = [{ empresa_id: 7, id_empleado: 1, fecha_inicio: MIERCOLES, fecha_fin: MIERCOLES }];
    await cerrar([]);
    expect((await fila(1)).estadoEntrada).toBe("En Ruta");
  });

  it("planilla: planillas.ts NO lee asistencia (ni sesiones_trabajo, ni incidencias, ni faltas) — el cierre no altera ninguna fórmula de planilla", () => {
    const planillas = readFileSync("src/lib/rrhh/planillas.ts", "utf8");
    expect(planillas).not.toMatch(/sesiones_trabajo|marcajes_en_ruta|incidencias|obtenerReporteAsistencias|estadoEntrada/);
    expect(planillas).toContain("sueldo_base");
    // Y esta feature tampoco toca planillas ni su generación.
    const feature = readFileSync("src/lib/rrhh/asistencia-diaria.ts", "utf8");
    expect(feature).not.toMatch(/from "\.\/planillas"|planilla_lineas|generarLineasPeriodo/);
    // La integración vive SOLO en el concepto de descuento (planilla-faltas + planilla-conceptos).
    expect(readFileSync("src/lib/rrhh/planilla-conceptos.ts", "utf8")).toContain("obtenerFaltasPlanilla");
  });
});
