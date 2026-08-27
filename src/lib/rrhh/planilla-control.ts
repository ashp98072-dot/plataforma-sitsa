import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { getPool } from "@/lib/db";

/** Orden común entre Q1/Q2: períodos de la empresa por ID, luego líneas.
 * Serializa las escrituras de Planillas de una empresa, no las de otras.
 */
export async function bloquearPeriodosPlanilla(conn: PoolConnection, empresaId: number, periodoId: number) {
  const [rows] = await conn.query<RowDataPacket[]>(
    "SELECT id, estado FROM rrhh_planilla_periodos WHERE empresa_id = ? ORDER BY id FOR UPDATE",
    [empresaId],
  );
  return rows.find((row) => Number(row.id) === periodoId);
}

/** Invocar con los períodos ya bloqueados; no cambia ni elimina la Q2. */
export async function exigirPrimeraQuincenaSinDependientes(conn: PoolConnection, empresaId: number, periodoId: number) {
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT q2.id FROM rrhh_planilla_periodos q1
     INNER JOIN rrhh_planilla_periodos q2 ON q2.empresa_id = q1.empresa_id
       AND q2.mes = q1.mes AND q2.anio = q1.anio
     WHERE q1.empresa_id = ? AND q1.id = ? AND q1.tipo_periodo = 'QUINCENA_1'
       AND q2.tipo_periodo = 'QUINCENA_2'
       AND q2.estado IN ('Generada', 'Cerrada', 'Pagada')
     LIMIT 1 FOR UPDATE`,
    [empresaId, periodoId],
  );
  if (rows.length) {
    throw new Error("La segunda quincena ya está generada. Para modificar la primera, revisa y cancela primero la segunda si no tiene pagos; una segunda quincena pagada requiere un ajuste separado.");
  }
}

export async function conPeriodoBloqueado<T>(empresaId: number, periodoId: number,
  operacion: (conn: PoolConnection, estado: string) => Promise<T>): Promise<T> {
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const periodo = await bloquearPeriodosPlanilla(conn, empresaId, periodoId);
    if (!periodo) throw new Error("Periodo no encontrado.");
    const resultado = await operacion(conn, String(periodo.estado));
    await conn.commit();
    return resultado;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}
