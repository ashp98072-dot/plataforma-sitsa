import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { query } from "@/lib/db";
import { parsearDivisorFalta } from "./config";
import { redondearQ } from "./contratos-pago";
import { toIsoDate } from "./dates";
import { esDomingo } from "./horario-teorico";
import { obtenerFeriadosEnRango } from "./vacaciones";

/**
 * RRHH-TOMAR-ASISTENCIA-2 — faltas confirmadas por RRHH como CONCEPTO DE
 * DESCUENTO de planilla (misma vía que las cuotas: entra a `descuentos`, al
 * snapshot y, al autorizar, se marca con `planilla_periodo_id`).
 *
 *   descuento por falta = redondearQ(sueldo_base / divisor_falta)
 *
 * - Solo SUELDO BASE (ni bonos, ni horas extra, ni prestaciones). Sin séptimo.
 * - IGSS e ISR NO cambian: el ISR 2026 no lee descuentos (planilla-fiscal-2026
 *   usa solo horas extra y prestaciones) y el IGSS sigue sobre el sueldo
 *   contractual. Ticket fiscal aparte.
 * - Elegibilidad = la de la propia planilla (generarLineasPeriodo incluye a
 *   todo empleado Activo; NO se filtra por tipo_contrato).
 * - Se REVALIDA al generar/autorizar: una falta deja de aplicar si hoy esa
 *   fecha tiene marcaje/jornada, vacaciones/permiso (incidencia), en ruta,
 *   viaje, es domingo/feriado, el horario es Variable o quedó fuera de la
 *   relación laboral.
 * - Si la migración de asistencia aún no está aplicada (tabla inexistente) no
 *   hay faltas: la planilla se comporta exactamente como antes.
 */
export type ItemFalta = { id: number; monto: number; concepto: string; fecha: string; notas: string };

const sinTabla = (e: unknown) => {
  const x = e as { code?: string; errno?: number };
  return x?.code === "ER_NO_SUCH_TABLE" || x?.errno === 1146;
};

const fmt = (iso: string) => iso.split("-").reverse().join("/");
const dia = (v: unknown) => toIsoDate(v as string | Date | null | undefined) ?? "";

export async function obtenerFaltasPlanilla(
  conn: PoolConnection,
  empresaId: number,
  periodo: { id: number; fechaInicio: string; fechaFin: string },
): Promise<Map<number, ItemFalta[]>> {
  const resultado = new Map<number, ItemFalta[]>();
  let ausencias: RowDataPacket[];
  try {
    const [ya] = await conn.query<RowDataPacket[]>(
      "SELECT id FROM rrhh_asistencia_ausencias WHERE empresa_id = ? AND planilla_periodo_id = ? LIMIT 1 FOR UPDATE",
      [empresaId, periodo.id],
    );
    if (ya.length) throw new Error("Este período tiene faltas históricas ya aplicadas. Requiere revisión explícita; no se liberaron ni modificaron.");
    [ausencias] = await conn.query<RowDataPacket[]>(
      `SELECT a.id, a.empleado_id, a.fecha, e.sueldo_base, e.tipo_horario, e.fecha_alta, e.fecha_egreso
       FROM rrhh_asistencia_ausencias a
       INNER JOIN empleados e ON e.id = a.empleado_id AND e.empresa_id = a.empresa_id
       WHERE a.empresa_id = ? AND a.estado = 'CONFIRMADA' AND a.planilla_periodo_id IS NULL
         AND a.fecha BETWEEN ? AND ? AND e.estado = 'Activo'
       ORDER BY a.fecha, a.id FOR UPDATE`,
      [empresaId, periodo.fechaInicio, periodo.fechaFin],
    );
  } catch (e) {
    if (sinTabla(e)) return resultado;
    throw e;
  }
  if (!ausencias.length) return resultado;

  const [sesiones] = await conn.query<RowDataPacket[]>(
    `SELECT id_empleado, fecha_jornada, salida_at FROM sesiones_trabajo
     WHERE empresa_id = ? AND fecha_jornada <= ? AND (fecha_jornada >= ? OR DATE(salida_at) >= ?)`,
    [empresaId, periodo.fechaFin, periodo.fechaInicio, periodo.fechaInicio],
  );
  const [incidencias] = await conn.query<RowDataPacket[]>(
    "SELECT id_empleado, fecha_inicio, fecha_fin FROM incidencias WHERE empresa_id = ? AND fecha_inicio <= ? AND fecha_fin >= ?",
    [empresaId, periodo.fechaFin, periodo.fechaInicio],
  );
  let enRuta: RowDataPacket[] = [];
  try {
    [enRuta] = await conn.query<RowDataPacket[]>(
      "SELECT id_empleado, fecha_inicio, fecha_fin FROM marcajes_en_ruta WHERE empresa_id = ? AND fecha_inicio <= ? AND fecha_fin >= ?",
      [empresaId, periodo.fechaFin, periodo.fechaInicio],
    );
  } catch (e) {
    if (!sinTabla(e)) throw e;
  }
  const feriados = await obtenerFeriadosEnRango(empresaId, periodo.fechaInicio, periodo.fechaFin);
  const [cfg] = await conn.query<RowDataPacket[]>(
    "SELECT valor FROM configuracion WHERE empresa_id = ? AND parametro = 'divisor_falta' LIMIT 1",
    [empresaId],
  ).catch(() => [[]] as unknown as [RowDataPacket[]]);
  const divisor = parsearDivisorFalta(cfg[0]?.valor);

  const cubre = (rows: RowDataPacket[], emp: number, fecha: string) =>
    rows.some((r) => Number(r.id_empleado) === emp && dia(r.fecha_inicio) <= fecha && dia(r.fecha_fin) >= fecha);
  const conJornada = (emp: number, fecha: string) =>
    sesiones.some((s) => {
      if (Number(s.id_empleado) !== emp) return false;
      const ini = dia(s.fecha_jornada);
      const fin = s.salida_at ? dia(s.salida_at) : ini;
      return ini <= fecha && fin >= fecha;
    });

  for (const a of ausencias) {
    const emp = Number(a.empleado_id);
    const fecha = dia(a.fecha);
    const sueldo = Number(a.sueldo_base ?? 0) || 0;
    const alta = dia(a.fecha_alta);
    const egreso = dia(a.fecha_egreso);
    if (sueldo <= 0) continue;
    if ((alta && fecha < alta) || (egreso && fecha > egreso)) continue;
    if (String(a.tipo_horario ?? "").includes("Variable")) continue;
    if (esDomingo(fecha) || feriados.has(fecha)) continue;
    if (conJornada(emp, fecha) || cubre(incidencias, emp, fecha) || cubre(enRuta, emp, fecha)) continue;
    const lista = resultado.get(emp) ?? [];
    lista.push({
      id: Number(a.id),
      monto: redondearQ(sueldo / divisor),
      concepto: `Falta injustificada ${fmt(fecha)}`,
      fecha,
      notas: `Ausencia confirmada por RRHH · sueldo base ÷ ${divisor}`,
    });
    resultado.set(emp, lista);
  }
  return resultado;
}

/** Faltas ya aplicadas a ESTE período (boleta del colaborador / detalle). */
export async function listarFaltasAplicadasDetalle(
  empresaId: number,
  empleadoId: number,
  periodoId: number,
): Promise<{ concepto: string; monto: number; fecha: string; notas: string }[]> {
  try {
    const rows = await query<RowDataPacket[]>(
      `SELECT fecha, monto_aplicado FROM rrhh_asistencia_ausencias
       WHERE empresa_id = ? AND empleado_id = ? AND planilla_periodo_id = ? AND estado = 'CONFIRMADA'
       ORDER BY fecha`,
      [empresaId, empleadoId, periodoId],
    );
    return rows.map((r) => ({
      concepto: `Falta injustificada ${fmt(dia(r.fecha))}`,
      monto: Number(r.monto_aplicado ?? 0),
      fecha: dia(r.fecha),
      notas: "Ausencia confirmada por RRHH",
    }));
  } catch {
    return []; // tabla ausente
  }
}
