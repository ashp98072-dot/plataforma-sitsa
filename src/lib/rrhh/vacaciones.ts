import {
  addYears,
  differenceInYears,
  format,
  parseISO,
  subDays,
} from "date-fns";
import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getPool, query } from "@/lib/db";

const DIAS_POR_PERIODO = 15;
const MAX_PERIODOS_VIGENTES = 2;

function toDate(value: string | Date): Date {
  if (value instanceof Date) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }
  return parseISO(String(value).slice(0, 10));
}

function toIso(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

export async function obtenerFeriadosEnRango(
  empresaId: number,
  fInicio: string,
  fFin: string,
): Promise<Set<string>> {
  try {
    const rows = await query<RowDataPacket[]>(
      `SELECT fecha FROM feriados
       WHERE empresa_id = ? AND activo = 1 AND fecha BETWEEN ? AND ?`,
      [empresaId, fInicio, fFin],
    );
    return new Set(
      rows.map((r) =>
        String(r.fecha instanceof Date ? toIso(r.fecha) : r.fecha).slice(0, 10),
      ),
    );
  } catch {
    return new Set();
  }
}

export async function contarDiasHabiles(
  empresaId: number,
  fInicio: string,
  fFin: string,
): Promise<number> {
  const inicio = toDate(fInicio);
  const fin = toDate(fFin);
  if (inicio > fin) return 0;
  const feriados = await obtenerFeriadosEnRango(empresaId, fInicio, fFin);
  let dias = 0;
  const dia = new Date(inicio);
  while (dia <= fin) {
    const fechaStr = toIso(dia);
    const weekdayPy = (dia.getDay() + 6) % 7;
    if (weekdayPy !== 6 && !feriados.has(fechaStr)) dias += 1;
    dia.setDate(dia.getDate() + 1);
  }
  return dias;
}

function contarDomingosEnRango(fechaInicio: Date, fechaFin: Date): number {
  if (fechaInicio > fechaFin) return 0;
  const weekdayPy = (fechaInicio.getDay() + 6) % 7;
  const diasHastaPrimerDomingo = (6 - weekdayPy) % 7;
  const primerDomingo = new Date(fechaInicio);
  primerDomingo.setDate(primerDomingo.getDate() + diasHastaPrimerDomingo);
  if (primerDomingo > fechaFin) return 0;
  const days = Math.floor(
    (fechaFin.getTime() - primerDomingo.getTime()) / (24 * 60 * 60 * 1000),
  );
  return Math.floor(days / 7) + 1;
}

function diasLaborablesEnRango(fechaInicio: Date, fechaFin: Date): number {
  if (fechaInicio > fechaFin) return 0;
  const diasTotales =
    Math.floor(
      (fechaFin.getTime() - fechaInicio.getTime()) / (24 * 60 * 60 * 1000),
    ) + 1;
  return diasTotales - contarDomingosEnRango(fechaInicio, fechaFin);
}

function calcularDiasAcumuladosProporcional(
  periodoInicio: Date,
  periodoFinTeorico: Date,
  hoy: Date,
  diasMeta: number,
): number {
  if (hoy < periodoInicio) return 0;
  const finTranscurrido = hoy < periodoFinTeorico ? hoy : periodoFinTeorico;
  const laborablesTranscurridos = diasLaborablesEnRango(
    periodoInicio,
    finTranscurrido,
  );
  const laborablesCompleto = diasLaborablesEnRango(
    periodoInicio,
    periodoFinTeorico,
  );
  if (laborablesCompleto <= 0) return 0;
  const acumulados =
    (diasMeta * laborablesTranscurridos) / laborablesCompleto;
  return Math.round(Math.min(acumulados, diasMeta) * 100) / 100;
}

async function fechaBaseAntiguedad(
  conn: PoolConnection,
  empresaId: number,
  idEmpleado: number,
): Promise<Date | null> {
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT fecha_alta FROM empleados
     WHERE id = ? AND empresa_id = ? LIMIT 1`,
    [idEmpleado, empresaId],
  );
  if (!rows[0]?.fecha_alta) return null;
  return toDate(rows[0].fecha_alta as string | Date);
}

export async function sincronizarPeriodosVacaciones(
  empresaId: number,
  idEmpleado: number,
): Promise<void> {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    const fechaAlta = await fechaBaseAntiguedad(conn, empresaId, idEmpleado);
    if (!fechaAlta) return;

    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    if (fechaAlta > hoy) return;

    const aniosCompletos = differenceInYears(hoy, fechaAlta);
    const [existentesRows] = await conn.query<RowDataPacket[]>(
      `SELECT id, anio_laboral, periodo_inicio, periodo_fin,
              dias_otorgados, dias_disponibles, estado
       FROM saldos_vacaciones
       WHERE empresa_id = ? AND id_empleado = ?`,
      [empresaId, idEmpleado],
    );
    const existentes = new Map<number, RowDataPacket>();
    for (const r of existentesRows) {
      if (r.anio_laboral != null) existentes.set(Number(r.anio_laboral), r);
    }

    for (let n = 1; n <= aniosCompletos + 1; n++) {
      const periodoInicio = addYears(fechaAlta, n - 1);
      const periodoFin = subDays(addYears(fechaAlta, n), 1);
      const esCompleto = n <= aniosCompletos;

      let diasOtorgadosNuevo: number;
      if (esCompleto) {
        diasOtorgadosNuevo = DIAS_POR_PERIODO;
      } else {
        diasOtorgadosNuevo = calcularDiasAcumuladosProporcional(
          periodoInicio,
          periodoFin,
          hoy,
          DIAS_POR_PERIODO,
        );
        if (diasOtorgadosNuevo <= 0 && !existentes.has(n)) continue;
      }

      const fila = existentes.get(n);
      if (!fila) {
        await conn.execute(
          `INSERT IGNORE INTO saldos_vacaciones
            (empresa_id, id_empleado, anio_laboral, periodo_inicio, periodo_fin,
             dias_otorgados, dias_disponibles, estado)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'Vigente')`,
          [
            empresaId,
            idEmpleado,
            n,
            toIso(periodoInicio),
            toIso(periodoFin),
            diasOtorgadosNuevo,
            diasOtorgadosNuevo,
          ],
        );
      } else if (String(fila.estado) !== "Vencido") {
        const otorgadosPrev = Number(fila.dias_otorgados);
        const disponiblesPrev = Number(fila.dias_disponibles);
        const consumido =
          Math.round((otorgadosPrev - disponiblesPrev) * 100) / 100;
        const disponiblesNuevo =
          Math.round(Math.max(diasOtorgadosNuevo - consumido, 0) * 100) / 100;
        await conn.execute(
          `UPDATE saldos_vacaciones
           SET periodo_inicio = ?, periodo_fin = ?,
               dias_otorgados = ?, dias_disponibles = ?
           WHERE id = ?`,
          [
            toIso(periodoInicio),
            toIso(periodoFin),
            diasOtorgadosNuevo,
            disponiblesNuevo,
            Number(fila.id),
          ],
        );
      }
    }

    const periodoEnCursoN = aniosCompletos + 1;
    const [periodos] = await conn.query<RowDataPacket[]>(
      `SELECT id, estado, anio_laboral, dias_otorgados, dias_disponibles
       FROM saldos_vacaciones
       WHERE empresa_id = ? AND id_empleado = ?
       ORDER BY anio_laboral DESC`,
      [empresaId, idEmpleado],
    );
    const completados = periodos.filter(
      (p) => Number(p.anio_laboral) !== periodoEnCursoN,
    );
    for (let idx = 0; idx < completados.length; idx++) {
      if (idx < MAX_PERIODOS_VIGENTES) continue;
      const p = completados[idx];
      if (String(p.estado) !== "Vencido") {
        await conn.execute(
          `UPDATE saldos_vacaciones
           SET estado = 'Vencido', dias_disponibles = 0 WHERE id = ?`,
          [Number(p.id)],
        );
      }
    }
  } finally {
    conn.release();
  }
}

export type PeriodoVacaciones = {
  id: number;
  anioLaboral: number;
  periodoInicio: string;
  periodoFin: string;
  diasOtorgados: number;
  diasDisponibles: number;
};

export async function obtenerPeriodosDisponibles(
  empresaId: number,
  idEmpleado: number,
): Promise<PeriodoVacaciones[]> {
  await sincronizarPeriodosVacaciones(empresaId, idEmpleado);
  const rows = await query<RowDataPacket[]>(
    `SELECT id, anio_laboral, periodo_inicio, periodo_fin,
            dias_otorgados, dias_disponibles
     FROM saldos_vacaciones
     WHERE empresa_id = ? AND id_empleado = ? AND estado = 'Vigente'
     ORDER BY anio_laboral ASC`,
    [empresaId, idEmpleado],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    anioLaboral: Number(r.anio_laboral),
    periodoInicio: String(r.periodo_inicio).slice(0, 10),
    periodoFin: String(r.periodo_fin).slice(0, 10),
    diasOtorgados: Number(r.dias_otorgados),
    diasDisponibles: Number(r.dias_disponibles),
  }));
}

export async function calcularSaldoTotalDisponible(
  empresaId: number,
  idEmpleado: number,
): Promise<number> {
  const periodos = await obtenerPeriodosDisponibles(empresaId, idEmpleado);
  return (
    Math.round(periodos.reduce((s, p) => s + p.diasDisponibles, 0) * 100) / 100
  );
}

export type DesgloseConsumo = {
  periodoInicio: string;
  periodoFin: string;
  diasTomados: number;
  diasRestantes: number;
};

export async function registrarVacacionesFifo(input: {
  empresaId: number;
  idEmpleado: number;
  fechaInicio: string;
  fechaFin: string;
  diasATomar: number;
  tipo?: string;
  subtipo?: string | null;
}): Promise<{
  ok: boolean;
  mensaje: string;
  desglose: DesgloseConsumo[];
  incidenciaId: number | null;
}> {
  const diasATomar = input.diasATomar;
  if (diasATomar <= 0) {
    return {
      ok: false,
      mensaje: "Los días a descontar deben ser mayores que cero.",
      desglose: [],
      incidenciaId: null,
    };
  }

  await sincronizarPeriodosVacaciones(input.empresaId, input.idEmpleado);
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();

    const [periodos] = await conn.query<RowDataPacket[]>(
      `SELECT id, periodo_inicio, periodo_fin, dias_disponibles
       FROM saldos_vacaciones
       WHERE empresa_id = ? AND id_empleado = ?
         AND estado = 'Vigente' AND dias_disponibles > 0
       ORDER BY anio_laboral ASC`,
      [input.empresaId, input.idEmpleado],
    );
    const saldoTotal = periodos.reduce(
      (s, p) => s + Number(p.dias_disponibles),
      0,
    );

    if (saldoTotal < diasATomar) {
      await conn.rollback();
      return {
        ok: false,
        mensaje: `Saldo insuficiente. Disponible: ${saldoTotal.toFixed(2)} día(s).`,
        desglose: [],
        incidenciaId: null,
      };
    }

    let incidenciaId: number;
    try {
      const [insertResult] = await conn.execute<ResultSetHeader>(
        `INSERT INTO incidencias
          (empresa_id, id_empleado, tipo, subtipo, fecha_inicio, fecha_fin, dias_habiles)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          input.empresaId,
          input.idEmpleado,
          input.tipo ?? "Vacaciones",
          input.subtipo ?? null,
          input.fechaInicio,
          input.fechaFin,
          diasATomar,
        ],
      );
      incidenciaId = Number(insertResult.insertId);
    } catch {
      const [insertResult] = await conn.execute<ResultSetHeader>(
        `INSERT INTO incidencias
          (empresa_id, id_empleado, tipo, fecha_inicio, fecha_fin, dias_habiles)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          input.empresaId,
          input.idEmpleado,
          input.tipo ?? "Vacaciones",
          input.fechaInicio,
          input.fechaFin,
          diasATomar,
        ],
      );
      incidenciaId = Number(insertResult.insertId);
    }

    // También en tabla vacaciones (historial simple)
    await conn.execute(
      `INSERT INTO vacaciones
        (empresa_id, id_empleado, fecha_inicio, fecha_fin, dias_habiles, estado)
       VALUES (?, ?, ?, ?, ?, 'Aprobado')`,
      [
        input.empresaId,
        input.idEmpleado,
        input.fechaInicio,
        input.fechaFin,
        diasATomar,
      ],
    );

    let restante = diasATomar;
    const desglose: DesgloseConsumo[] = [];

    for (const p of periodos) {
      if (restante <= 0) break;
      const disponibles = Number(p.dias_disponibles);
      const tomar = Math.min(disponibles, restante);
      if (tomar <= 0) continue;
      const nuevoDisponible = disponibles - tomar;
      await conn.execute(
        "UPDATE saldos_vacaciones SET dias_disponibles = ? WHERE id = ?",
        [nuevoDisponible, Number(p.id)],
      );
      await conn.execute(
        `INSERT INTO detalle_consumo_vacaciones
          (incidencia_id, saldo_id, dias_tomados) VALUES (?, ?, ?)`,
        [incidenciaId, Number(p.id), tomar],
      );
      desglose.push({
        periodoInicio: String(p.periodo_inicio).slice(0, 10),
        periodoFin: String(p.periodo_fin).slice(0, 10),
        diasTomados: tomar,
        diasRestantes: nuevoDisponible,
      });
      restante -= tomar;
    }

    await conn.commit();
    return {
      ok: true,
      mensaje: "Vacaciones registradas (FIFO).",
      desglose,
      incidenciaId,
    };
  } catch (err) {
    await conn.rollback();
    return {
      ok: false,
      mensaje:
        err instanceof Error
          ? err.message
          : "Error al registrar. ¿Importaste migrate-2026-08-rrhh-core.sql?",
      desglose: [],
      incidenciaId: null,
    };
  } finally {
    conn.release();
  }
}

export async function listarVacaciones(
  empresaId: number,
): Promise<RowDataPacket[]> {
  return query<RowDataPacket[]>(
    `SELECT v.*, e.codigo AS emp_codigo, e.nombre AS emp_nombre
     FROM vacaciones v
     INNER JOIN empleados e ON e.id = v.id_empleado
     WHERE v.empresa_id = ?
     ORDER BY v.fecha_inicio DESC
     LIMIT 300`,
    [empresaId],
  );
}
