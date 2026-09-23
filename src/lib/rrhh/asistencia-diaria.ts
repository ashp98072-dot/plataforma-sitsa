import type { RowDataPacket } from "mysql2";
import { getPool, query } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import { generarDiasLaborables } from "./reportes";
import { asegurarSchemaEmpleados } from "./empleados-schema";
import { esDomingo } from "./horario-teorico";

/**
 * RRHH-TOMAR-ASISTENCIA-1 — "Tomar asistencia" (RRHH > Marcajes): RRHH/admin
 * ve el personal ACTIVO del día, marca con checkbox quién asistió y al
 * "Cerrar asistencia del día" se crean las jornadas que faltan.
 *
 * NO hay una segunda fuente de verdad. Hallazgos del discovery:
 *  - La asistencia vive en `sesiones_trabajo` (una fila por empleado/día:
 *    entrada_at, salida_at, estado, comentarios_rrhh) + `incidencias`
 *    (vacaciones/permisos) + `marcajes_en_ruta`/sesiones multi-día (viaje).
 *  - Una FALTA no es un registro: los reportes (reportes.ts,
 *    obtenerReporteAsistencias) la DERIVAN — día laborable sin sesión, sin
 *    viaje/en ruta y sin incidencia => "Falta". Por eso "cerrar" NO escribe
 *    faltas (no se inventó una tabla paralela): quien no tiene sesión sigue
 *    siendo falta para los reportes, y quien tiene vacaciones/permiso/en
 *    ruta no lo es.
 *  - Planillas (planillas.ts) NO lee asistencia (calcula sobre sueldo_base,
 *    bonos, descuentos, prestaciones y horas extra): no se tocó ninguna
 *    fórmula de planilla.
 *  - No existe cierre diario persistido; la operación es idempotente por
 *    construcción (solo crea la jornada si el empleado NO tiene ya una ese
 *    día, bajo un candado por empresa+fecha) — un segundo cierre crea 0.
 *
 * La jornada administrativa usa el horario teórico INDIVIDUAL del empleado
 * (entrada = hora_entrada_teorica, salida = hora_salida_teorica: a tiempo,
 * sin tardanza ni salida temprana). Sin GPS, sin foto, sin evidencia
 * inventada. Se distingue por el prefijo de comentarios_rrhh (campo ya
 * existente; no hay columna `origen`) y por la bitácora de auditoría.
 */
export const MARCA_ASISTENCIA_ADMINISTRATIVA = "ASISTENCIA ADMINISTRATIVA";

export type EstadoDia =
  | "Presente"
  | "Marcaje existente"
  | "Vacaciones"
  | "Justificado"
  | "En ruta"
  | "No aplica"
  | "Requiere registro manual"
  | "Pendiente";

export type EmpleadoAsistencia = {
  id: number;
  codigo: string;
  nombre: string;
  puesto: string;
  horario: { tipo: string; entrada: string | null; salida: string | null };
  estado: EstadoDia;
  detalle: string;
  /** Solo un empleado "Pendiente" puede marcarse con el checkbox. */
  seleccionable: boolean;
  /** Marcaje real ya existente (o jornada administrativa previa): se muestra ✓ bloqueado. */
  marcado: boolean;
};

export type ResumenAsistencia = {
  presentes: number;
  vacaciones: number;
  permisos: number;
  enRuta: number;
  noAplica: number;
  requiereManual: number;
  ausentes: number;
};

export type AsistenciaDia = {
  fecha: string;
  laborable: boolean;
  empleados: EmpleadoAsistencia[];
  resumen: ResumenAsistencia;
};

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

function fechaCalendarioValida(f: string): boolean {
  if (!FECHA_RE.test(f)) return false;
  const [y, m, d] = f.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

const iso = (v: unknown): string => (v instanceof Date
  ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`
  : String(v ?? "").slice(0, 10));
const hora8 = (v: unknown): string | null => {
  const s = String(v ?? "").trim();
  const m = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  return `${m[1].padStart(2, "0")}:${m[2]}:${m[3] ?? "00"}`;
};
const horaDeTs = (v: unknown): string => {
  if (v instanceof Date) return `${String(v.getHours()).padStart(2, "0")}:${String(v.getMinutes()).padStart(2, "0")}`;
  const s = String(v ?? "");
  return s.length >= 16 ? s.slice(11, 16) : "";
};

/** `fecha` válida y no futura (la fecha "hoy" la decide el llamador: hoyLocal, zona Guatemala). */
export function validarFechaAsistencia(fecha: string, hoy: string): string | null {
  if (!fechaCalendarioValida(fecha)) return "Fecha inválida (YYYY-MM-DD).";
  if (fecha > hoy) return "No se puede tomar asistencia de una fecha futura.";
  return null;
}

/** Estado real del día de CADA empleado activo, resuelto en servidor y por empresa. */
export async function obtenerAsistenciaDia(empresaId: number, fecha: string): Promise<AsistenciaDia> {
  await asegurarSchemaEmpleados().catch(() => undefined);
  const [empleados, sesiones, cubiertos, incidencias, enRutaRows, laborables] = await Promise.all([
    query<RowDataPacket[]>(
      `SELECT id, codigo, nombre, puesto, fecha_alta, fecha_egreso, tipo_horario,
              hora_entrada_teorica, hora_salida_teorica
       FROM empleados WHERE empresa_id = ? AND estado = 'Activo' ORDER BY nombre`,
      [empresaId],
    ),
    query<RowDataPacket[]>(
      `SELECT id, id_empleado, entrada_at, salida_at, estado, comentarios_rrhh
       FROM sesiones_trabajo WHERE empresa_id = ? AND fecha_jornada = ?`,
      [empresaId, fecha],
    ),
    query<RowDataPacket[]>(
      `SELECT DISTINCT id_empleado FROM sesiones_trabajo
       WHERE empresa_id = ? AND fecha_jornada < ? AND salida_at IS NOT NULL AND DATE(salida_at) >= ?`,
      [empresaId, fecha, fecha],
    ),
    query<RowDataPacket[]>(
      `SELECT id_empleado, tipo FROM incidencias
       WHERE empresa_id = ? AND fecha_inicio <= ? AND fecha_fin >= ?`,
      [empresaId, fecha, fecha],
    ),
    query<RowDataPacket[]>(
      `SELECT id_empleado FROM marcajes_en_ruta
       WHERE empresa_id = ? AND fecha_inicio <= ? AND fecha_fin >= ?`,
      [empresaId, fecha, fecha],
    ).catch(() => [] as RowDataPacket[]),
    generarDiasLaborables(empresaId, fecha, fecha),
  ]);

  const laborable = laborables.includes(fecha);
  const sesionPorEmp = new Map<number, RowDataPacket>();
  for (const s of sesiones) {
    const id = Number(s.id_empleado);
    const previa = sesionPorEmp.get(id);
    if (!previa || Number(s.id) > Number(previa.id)) sesionPorEmp.set(id, s);
  }
  const viajeMultidia = new Set(cubiertos.map((r) => Number(r.id_empleado)));
  const enRuta = new Set(enRutaRows.map((r) => Number(r.id_empleado)));
  const incPorEmp = new Map<number, string>();
  for (const i of incidencias) if (!incPorEmp.has(Number(i.id_empleado))) incPorEmp.set(Number(i.id_empleado), String(i.tipo));

  const lista: EmpleadoAsistencia[] = [];
  for (const e of empleados) {
    const id = Number(e.id);
    // Relación laboral: nunca antes de la contratación ni después del egreso.
    const alta = e.fecha_alta ? iso(e.fecha_alta) : "";
    const egreso = e.fecha_egreso ? iso(e.fecha_egreso) : "";
    if ((alta && fecha < alta) || (egreso && fecha > egreso)) continue;

    const tipo = String(e.tipo_horario ?? "Fijo");
    const variable = tipo.includes("Variable");
    const entrada = hora8(e.hora_entrada_teorica);
    const salida = hora8(e.hora_salida_teorica);
    const base = {
      id, codigo: String(e.codigo ?? ""), nombre: String(e.nombre ?? ""), puesto: String(e.puesto ?? ""),
      horario: { tipo, entrada: variable ? null : entrada, salida: variable ? null : salida },
    };
    const fila = (estado: EstadoDia, detalle: string, extra: Partial<EmpleadoAsistencia> = {}): EmpleadoAsistencia => ({
      ...base, estado, detalle, seleccionable: false, marcado: false, ...extra,
    });

    const s = sesionPorEmp.get(id);
    if (s) {
      const admin = String(s.comentarios_rrhh ?? "").startsWith(MARCA_ASISTENCIA_ADMINISTRATIVA);
      const cerrada = Boolean(s.salida_at) && /cerrada/i.test(String(s.estado ?? ""));
      const rango = `${horaDeTs(s.entrada_at)}${s.salida_at ? ` – ${horaDeTs(s.salida_at)}` : " (jornada abierta)"}`;
      lista.push(fila(cerrada ? "Presente" : "Marcaje existente",
        `${admin ? "Asistencia administrativa" : "Marcaje real"} ${rango}`, { marcado: true }));
      continue;
    }
    if (viajeMultidia.has(id) || enRuta.has(id)) { lista.push(fila("En ruta", viajeMultidia.has(id) ? "Viaje en curso" : "En ruta")); continue; }
    const inc = incPorEmp.get(id);
    if (inc) { lista.push(fila(/vacaciones/i.test(inc) ? "Vacaciones" : "Justificado", inc)); continue; }
    if (!laborable) { lista.push(fila("No aplica", esDomingo(fecha) ? "Domingo" : "Feriado")); continue; }
    if (variable || !entrada || !salida) { lista.push(fila("Requiere registro manual", variable ? "Horario variable" : "Sin horario teórico definido")); continue; }
    lista.push(fila("Pendiente", "Sin registro", { seleccionable: true }));
  }

  const cuenta = (p: (e: EmpleadoAsistencia) => boolean) => lista.filter(p).length;
  const resumen: ResumenAsistencia = {
    presentes: cuenta((e) => e.estado === "Presente" || e.estado === "Marcaje existente"),
    vacaciones: cuenta((e) => e.estado === "Vacaciones"),
    permisos: cuenta((e) => e.estado === "Justificado"),
    enRuta: cuenta((e) => e.estado === "En ruta"),
    noAplica: cuenta((e) => e.estado === "No aplica"),
    requiereManual: cuenta((e) => e.estado === "Requiere registro manual"),
    ausentes: cuenta((e) => e.estado === "Pendiente"),
  };
  return { fecha, laborable, empleados: lista, resumen };
}

export type ResultadoCierre =
  | {
      ok: true;
      fecha: string;
      creados: number;
      yaRegistrados: number;
      omitidos: { empleadoId: number; motivo: string }[];
      resumen: ResumenAsistencia;
      ausentes: { id: number; codigo: string; nombre: string }[];
    }
  | { ok: false; status: 400 | 409; error: string };

/**
 * Cierra la asistencia del día: crea la jornada administrativa de cada
 * empleado SELECCIONADO que siga "Pendiente". El estado se recalcula aquí —
 * nunca se confía en lo que el cliente crea que es elegible. No escribe
 * faltas (ver encabezado). Idempotente y con candado por empresa+fecha.
 */
export async function cerrarAsistenciaDia(
  empresaId: number,
  input: { fecha: string; empleadoIds: number[]; usuario: string; hoy: string },
): Promise<ResultadoCierre> {
  const errorFecha = validarFechaAsistencia(input.fecha, input.hoy);
  if (errorFecha) return { ok: false, status: 400, error: errorFecha };

  const conn = await getPool().getConnection();
  const lockKey = `rrhh_asistencia_${empresaId}_${input.fecha}`;
  let lockAdquirido = false;
  try {
    const [lockRows] = await conn.query<RowDataPacket[]>("SELECT GET_LOCK(?, 8) AS l", [lockKey]).catch(() => [[]] as unknown as [RowDataPacket[]]);
    lockAdquirido = Number(lockRows[0]?.l) === 1;
    if (!lockAdquirido) {
      return { ok: false, status: 409, error: "Ya hay un cierre de asistencia en curso para esta fecha. Intenta de nuevo." };
    }

    // Se lee DENTRO del candado: dos cierres simultáneos no crean la misma jornada dos veces.
    const dia = await obtenerAsistenciaDia(empresaId, input.fecha);
    const porId = new Map(dia.empleados.map((e) => [e.id, e]));
    const seleccion = [...new Set(input.empleadoIds)];
    const omitidos: { empleadoId: number; motivo: string }[] = [];
    const aCrear: EmpleadoAsistencia[] = [];
    let yaRegistrados = 0;
    for (const id of seleccion) {
      const e = porId.get(id);
      if (!e) { omitidos.push({ empleadoId: id, motivo: "No es un empleado activo de esta empresa para esa fecha" }); continue; }
      if (e.marcado) { yaRegistrados += 1; continue; }
      if (!e.seleccionable) { omitidos.push({ empleadoId: id, motivo: `${e.estado}: ${e.detalle}` }); continue; }
      aCrear.push(e);
    }

    if (aCrear.length) {
      await conn.beginTransaction();
      try {
        for (const e of aCrear) {
          await conn.execute(
            `INSERT INTO sesiones_trabajo
               (empresa_id, id_empleado, fecha_jornada, entrada_at, salida_at, estado, comentarios_rrhh)
             VALUES (?, ?, ?, ?, ?, 'CERRADA', ?)`,
            [
              empresaId, e.id, input.fecha,
              `${input.fecha} ${e.horario.entrada}`, `${input.fecha} ${e.horario.salida}`,
              `${MARCA_ASISTENCIA_ADMINISTRATIVA} — confirmada por ${input.usuario} (sin marcaje real)`,
            ],
          );
        }
        await registrarAuditoriaTx(conn, {
          empresaId, usuario: input.usuario, accion: "asistencia_administrativa", modulo: "rrhh",
          detalle: `Asistencia del ${input.fecha}: ${aCrear.length} jornada(s) administrativa(s) creada(s) [${aCrear.map((e) => e.codigo || e.id).join(", ")}]; ${yaRegistrados} con marcaje existente; ${omitidos.length} omitido(s).`.slice(0, 2000),
        });
        await conn.commit();
      } catch (e) {
        await conn.rollback();
        throw e;
      }
    }

    const despues = await obtenerAsistenciaDia(empresaId, input.fecha);
    return {
      ok: true,
      fecha: input.fecha,
      creados: aCrear.length,
      yaRegistrados,
      omitidos,
      resumen: despues.resumen,
      ausentes: despues.empleados.filter((e) => e.estado === "Pendiente").map((e) => ({ id: e.id, codigo: e.codigo, nombre: e.nombre })),
    };
  } finally {
    if (lockAdquirido) await conn.query("SELECT RELEASE_LOCK(?)", [lockKey]).catch(() => undefined);
    conn.release();
  }
}
