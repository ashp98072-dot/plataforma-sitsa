import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { getPool } from "@/lib/db";

/** Mismo orden que generación: período primero, después sus líneas. */
export async function conPeriodoBloqueado<T>(empresaId: number, periodoId: number,
  operacion: (conn: PoolConnection, estado: string) => Promise<T>): Promise<T> {
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query<RowDataPacket[]>(
      "SELECT estado FROM rrhh_planilla_periodos WHERE id = ? AND empresa_id = ? FOR UPDATE",
      [periodoId, empresaId],
    );
    if (!rows[0]) throw new Error("Periodo no encontrado.");
    const resultado = await operacion(conn, String(rows[0].estado));
    await conn.commit();
    return resultado;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}
