import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { getPool, query } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import { generarDiasLaborables } from "./reportes";
import { asegurarSchemaEmpleados } from "./empleados-schema";
import { esDomingo } from "./horario-teorico";

/**
 * RRHH-TOMAR-ASISTENCIA — "Tomar asistencia" (RRHH > Marcajes): RRHH/admin
 * ve el personal ACTIVO del día, marca con checkbox quién asistió y al
 * "Cerrar asistencia del día" queda persistido quién asistió y quién NO.
 *
 * Modelo (RRHH-TOMAR-ASISTENCIA-2):
 *  - PRESENTE: `sesiones_trabajo` (una fila por empleado/día). Los reportes
 *    (reportes.ts) siguen derivando de ahí; no hay segunda fuente de verdad.
 *  - AUSENCIA CONFIRMADA: `rrhh_asistencia_ausencias` (CONFIRMADA/ANULADA,
 *    nunca se borra). Solo la escribe el cierre para quien quedó sin marcar
 *    y era elegible. NO se usa una incidencia "Falta" (las incidencias son
 *    rangos justificativos y el reporte las trata como justificación).
 *  - CIERRE DEL DÍA: `rrhh_asistencia_cierres` distingue "día pendiente" de
 *    "día cerrado por RRHH".
 *  - PLANILLA: cada ausencia CONFIRMADA vigente entra como concepto de
 *    descuento (planilla-faltas.ts); al autorizar se marca con
 *    planilla_periodo_id. Fechas de períodos Cerrados/Pagados/autorizados
 *    quedan BLOQUEADAS aquí (hay que usar el flujo de reapertura/corrección
 *    de planilla). Corregir una falta = marcar al empleado presente y volver
 *    a cerrar: se crea la jornada y la ausencia pasa a ANULADA.
 *  - Idempotente: candado por empresa+fecha, UNIQUE (empresa, empleado,
 *    fecha) e INSERT IGNORE; un segundo cierre no duplica nada.
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
  | "Ausente"
  | "Pendiente";

export type EmpleadoAsistencia = {
  id: number;
  codigo: string;
  nombre: string;
  puesto: string;
  horario: { tipo: string; entrada: string | null; salida: string | null };
  estado: EstadoDia;
  detalle: string;
  /** Pendiente o Ausente (corregible) puede marcarse con el checkbox. */
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
  /** Pendientes (día sin cerrar) + ausencias confirmadas. */
  ausentes: number;
};

export type AsistenciaDia = {
  fecha: string;
  laborable: boolean;
  /** RRHH ya cerró este día (rrhh_asistencia_cierres); null = día pendiente. */
  cierre: { cerradoPor: string; cerradoEn: string } | null;
  /** Mensaje si la fecha cae en una planilla Cerrada/Pagada/autorizada (no se puede modificar). */
  bloqueo: string | null;
  empleados: EmpleadoAsistencia[];
  resumen: ResumenAsistencia;
};

const sinTabla = (e: unknown) => {
  const x = e as { code?: string; errno?: number };
  return x?.code === "ER_NO_SUCH_TABLE" || x?.errno === 1146;
};
const MSG_MIGRACION = "Falta aplicar la migración de asistencia (rrhh_asistencia_cierres / rrhh_asistencia_ausencias). No se guardó nada.";
const fmtFecha = (f: string) => f.split("-").reverse().join("/");

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
  const [empleados, sesiones, cubiertos, incidencias, enRutaRows, laborables, ausenciasRows, cierreRows, bloqueoRows] = await Promise.all([
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
    // Tablas de la migración de asistencia: si aún no existen, el día se ve como antes (sin cierre ni ausencias).
    query<RowDataPacket[]>(
      `SELECT empleado_id, estado, planilla_periodo_id FROM rrhh_asistencia_ausencias WHERE empresa_id = ? AND fecha = ?`,
      [empresaId, fecha],
    ).catch(() => [] as RowDataPacket[]),
    query<RowDataPacket[]>(
      `SELECT cerrado_por, cerrado_en FROM rrhh_asistencia_cierres WHERE empresa_id = ? AND fecha = ?`,
      [empresaId, fecha],
    ).catch(() => [] as RowDataPacket[]),
    query<RowDataPacket[]>(
      `SELECT codigo, estado FROM rrhh_planilla_periodos
       WHERE empresa_id = ? AND fecha_inicio <= ? AND fecha_fin >= ? AND estado <> 'Cancelado'
         AND (estado IN ('Cerrada', 'Pagada') OR autorizado_en IS NOT NULL) LIMIT 1`,
      [empresaId, fecha, fecha],
    ).catch(() => [] as RowDataPacket[]),
  ]);

  const laborable = laborables.includes(fecha);
  const sesionPorEmp = new Map<number, RowDataPacket>();
  for (const s of sesiones) {
    const id = Number(s.id_empleado);
    const previa = sesionPorEmp.get(id);
    if (!previa || Number(s.id) > Number(previa.id)) sesionPorEmp.set(id, s);
  }
  const ausenciaPorEmp = new Map<number, RowDataPacket>();
  for (const a of ausenciasRows) if (String(a.estado) === "CONFIRMADA") ausenciaPorEmp.set(Number(a.empleado_id), a);
  const bloqueo = bloqueoRows[0]
    ? `La fecha ${fmtFecha(fecha)} pertenece a la planilla ${String(bloqueoRows[0].codigo)} (${String(bloqueoRows[0].estado)}), que ya está cerrada. Para modificar la asistencia de esa fecha primero debe usarse el flujo de reapertura/corrección de planilla.`
    : null;
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
    const aus = ausenciaPorEmp.get(id);
    if (aus) {
      const aplicada = aus.planilla_periodo_id != null;
      lista.push(fila("Ausente", aplicada ? "Falta confirmada · ya descontada en planilla" : "Falta confirmada por RRHH", { seleccionable: !aplicada }));
      continue;
    }
    lista.push(fila("Pendiente", "Sin registro", { seleccionable: true }));
  }
  if (bloqueo) for (const e of lista) e.seleccionable = false;

  const cuenta = (p: (e: EmpleadoAsistencia) => boolean) => lista.filter(p).length;
  const resumen: ResumenAsistencia = {
    presentes: cuenta((e) => e.estado === "Presente" || e.estado === "Marcaje existente"),
    vacaciones: cuenta((e) => e.estado === "Vacaciones"),
    permisos: cuenta((e) => e.estado === "Justificado"),
    enRuta: cuenta((e) => e.estado === "En ruta"),
    noAplica: cuenta((e) => e.estado === "No aplica"),
    requiereManual: cuenta((e) => e.estado === "Requiere registro manual"),
    ausentes: cuenta((e) => e.estado === "Pendiente" || e.estado === "Ausente"),
  };
  const c = cierreRows[0];
  const cierre = c ? { cerradoPor: String(c.cerrado_por), cerradoEn: String(c.cerrado_en instanceof Date ? c.cerrado_en.toISOString() : c.cerrado_en) } : null;
  return { fecha, laborable, cierre, bloqueo, empleados: lista, resumen };
}

export type ResultadoCierre =
  | {
      ok: true;
      fecha: string;
      /** Jornadas administrativas creadas en este cierre. */
      creados: number;
      /** Ausencias confirmadas NUEVAS en este cierre. */
      ausenciasConfirmadas: number;
      /** Ausencias previas anuladas porque RRHH corrigió marcando al empleado presente. */
      ausenciasAnuladas: number;
      yaRegistrados: number;
      omitidos: { empleadoId: number; motivo: string }[];
      resumen: ResumenAsistencia;
      ausentes: { id: number; codigo: string; nombre: string }[];
    }
  | { ok: false; status: 400 | 409; error: string };

/**
 * Cierra la asistencia del día. El estado se recalcula aquí — nunca se confía
 * en lo que el cliente crea que es elegible:
 *  - seleccionado + Pendiente    → jornada administrativa (horario teórico).
 *  - seleccionado + Ausente      → corrección: jornada + ausencia ANULADA.
 *  - NO seleccionado + Pendiente → ausencia CONFIRMADA (INSERT IGNORE).
 *  - Vacaciones/permiso/en ruta/no laborable/Variable → nada (no es falta).
 * Todo (jornadas, ausencias, cierre, auditoría) en UNA transacción, bajo
 * candado por empresa+fecha. Fechas en planilla cerrada: 409 sin escribir.
 */
export async function cerrarAsistenciaDia(
  empresaId: number,
  input: { fecha: string; empleadoIds: number[]; usuario: string; hoy: string },
): Promise<ResultadoCierre> {
  const errorFecha = validarFechaAsistencia(input.fecha, input.hoy);
  if (errorFecha) return { ok: false, status: 400, error: errorFecha };

  try {
    await query("SELECT 1 FROM rrhh_asistencia_cierres LIMIT 1");
    await query("SELECT 1 FROM rrhh_asistencia_ausencias LIMIT 1");
  } catch (e) {
    if (sinTabla(e)) return { ok: false, status: 409, error: MSG_MIGRACION };
    throw e;
  }

  const conn = await getPool().getConnection();
  const lockKey = `rrhh_asistencia_${empresaId}_${input.fecha}`;
  let lockAdquirido = false;
  try {
    const [lockRows] = await conn.query<RowDataPacket[]>("SELECT GET_LOCK(?, 8) AS l", [lockKey]).catch(() => [[]] as unknown as [RowDataPacket[]]);
    lockAdquirido = Number(lockRows[0]?.l) === 1;
    if (!lockAdquirido) {
      return { ok: false, status: 409, error: "Ya hay un cierre de asistencia en curso para esta fecha. Intenta de nuevo." };
    }

    // Se lee DENTRO del candado: dos cierres simultáneos no crean lo mismo dos veces.
    const dia = await obtenerAsistenciaDia(empresaId, input.fecha);
    if (dia.bloqueo) return { ok: false, status: 409, error: dia.bloqueo };
    if (!dia.laborable) return { ok: false, status: 400, error: "La fecha no es día laborable (domingo o feriado): no aplica tomar asistencia." };

    const porId = new Map(dia.empleados.map((e) => [e.id, e]));
    const seleccion = new Set(input.empleadoIds);
    const omitidos: { empleadoId: number; motivo: string }[] = [];
    const aCrear: EmpleadoAsistencia[] = [];
    const aCorregir: EmpleadoAsistencia[] = [];
    let yaRegistrados = 0;
    for (const id of seleccion) {
      const e = porId.get(id);
      if (!e) { omitidos.push({ empleadoId: id, motivo: "No es un empleado activo de esta empresa para esa fecha" }); continue; }
      if (e.marcado) { yaRegistrados += 1; continue; }
      if (!e.seleccionable) { omitidos.push({ empleadoId: id, motivo: `${e.estado}: ${e.detalle}` }); continue; }
      (e.estado === "Ausente" ? aCorregir : aCrear).push(e);
    }
    // Elegibles que RRHH NO marcó: quedan como ausencia confirmada.
    const aAusentar = dia.empleados.filter((e) => e.estado === "Pendiente" && e.seleccionable && !seleccion.has(e.id));

    let confirmadas = 0;
    await conn.beginTransaction();
    try {
      const crearJornada = (e: EmpleadoAsistencia) => conn.execute(
        `INSERT INTO sesiones_trabajo
           (empresa_id, id_empleado, fecha_jornada, entrada_at, salida_at, estado, comentarios_rrhh)
         VALUES (?, ?, ?, ?, ?, 'CERRADA', ?)`,
        [
          empresaId, e.id, input.fecha,
          `${input.fecha} ${e.horario.entrada}`, `${input.fecha} ${e.horario.salida}`,
          `${MARCA_ASISTENCIA_ADMINISTRATIVA} — confirmada por ${input.usuario} (sin marcaje real)`,
        ],
      );
      for (const e of aCrear) await crearJornada(e);
      for (const e of aCorregir) {
        const [r] = await conn.execute<ResultSetHeader>(
          `UPDATE rrhh_asistencia_ausencias
           SET estado = 'ANULADA', anulado_por = ?, anulado_en = NOW(), motivo_anulacion = 'Corrección: RRHH registró asistencia'
           WHERE empresa_id = ? AND empleado_id = ? AND fecha = ? AND estado = 'CONFIRMADA' AND planilla_periodo_id IS NULL`,
          [input.usuario, empresaId, e.id, input.fecha],
        );
        if (r.affectedRows !== 1) throw new Error("La ausencia ya fue utilizada en una planilla; no se puede anular. Usa el flujo de reapertura/corrección de planilla.");
        await crearJornada(e);
      }
      for (const e of aAusentar) {
        const [r] = await conn.execute<ResultSetHeader>(
          `INSERT IGNORE INTO rrhh_asistencia_ausencias (empresa_id, empleado_id, fecha, estado, confirmado_por)
           VALUES (?, ?, ?, 'CONFIRMADA', ?)`,
          [empresaId, e.id, input.fecha, input.usuario],
        );
        confirmadas += Number(r.affectedRows) === 1 ? 1 : 0;
      }
      const presentes = dia.resumen.presentes + aCrear.length + aCorregir.length;
      const ausentes = dia.resumen.ausentes - aCrear.length - aCorregir.length;
      await conn.execute(
        `INSERT INTO rrhh_asistencia_cierres (empresa_id, fecha, cerrado_por, presentes, ausentes, justificados)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE actualizado_por = VALUES(cerrado_por), actualizado_en = NOW(),
           presentes = VALUES(presentes), ausentes = VALUES(ausentes), justificados = VALUES(justificados)`,
        [empresaId, input.fecha, input.usuario, presentes, ausentes, dia.resumen.vacaciones + dia.resumen.permisos + dia.resumen.enRuta],
      );
      if (aCrear.length || aCorregir.length || confirmadas) {
        const cod = (l: EmpleadoAsistencia[]) => l.map((e) => e.codigo || e.id).join(", ");
        await registrarAuditoriaTx(conn, {
          empresaId, usuario: input.usuario, accion: "asistencia_administrativa", modulo: "rrhh",
          detalle: `Asistencia del ${input.fecha}: ${aCrear.length + aCorregir.length} jornada(s) administrativa(s) creada(s) [${cod([...aCrear, ...aCorregir])}]; ${confirmadas} ausencia(s) confirmada(s) [${cod(aAusentar)}]; ${aCorregir.length} ausencia(s) anulada(s) por corrección; ${yaRegistrados} con marcaje existente; ${omitidos.length} omitido(s).`.slice(0, 2000),
        });
      }
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    }

    const despues = await obtenerAsistenciaDia(empresaId, input.fecha);
    return {
      ok: true,
      fecha: input.fecha,
      creados: aCrear.length + aCorregir.length,
      ausenciasConfirmadas: confirmadas,
      ausenciasAnuladas: aCorregir.length,
      yaRegistrados,
      omitidos,
      resumen: despues.resumen,
      ausentes: despues.empleados.filter((e) => e.estado === "Ausente").map((e) => ({ id: e.id, codigo: e.codigo, nombre: e.nombre })),
    };
  } finally {
    if (lockAdquirido) await conn.query("SELECT RELEASE_LOCK(?)", [lockKey]).catch(() => undefined);
    conn.release();
  }
}
