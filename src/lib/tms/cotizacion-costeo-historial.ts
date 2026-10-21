import type { RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import { getPool, type SqlParams } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";

/**
 * COTIZACIONES — HISTORIAL DE COSTEOS: selección de la versión «utilizada».
 *
 * Las versiones son INMUTABLES (snapshots, importes y componentes jamás se actualizan). Lo único que cambia es la marca de selección
 * (es_seleccionado / seleccionado_por / seleccionado_en), que NO es contenido del costeo. MariaDB no tiene índice único parcial, así que
 * «a lo sumo una seleccionada por cotización» se garantiza AQUÍ, en una transacción: se bloquea la cotización padre y todas sus versiones
 * (SELECT ... FOR UPDATE) antes de mover la marca. Todo se revalida contra empresa_id + cotizacion_id + costeo_id.
 */

export const MENSAJE_SELECCION_SOLO_BORRADOR = "Solo se puede cambiar el costeo utilizado mientras la cotización está en Borrador.";
export const MENSAJE_COSTEO_NO_ENCONTRADO = "Costeo no encontrado en esta cotización.";

/** `status` es el código HTTP que corresponde (404 no existe en esta empresa/cotización; 409 estado no permite el cambio). */
export class ErrorSeleccionCosteo extends Error {
  readonly status: 404 | 409;
  constructor(mensaje: string, status: 404 | 409) {
    super(mensaje);
    this.name = "ErrorSeleccionCosteo";
    this.status = status;
  }
}

async function queryConn<T extends RowDataPacket[]>(conn: PoolConnection, sql: string, params: SqlParams = []): Promise<T> {
  const [rows] = await conn.query<T>(sql, params);
  return rows;
}

export type ResultadoSeleccionCosteo = { costeoId: number; version: number; cambio: boolean };

/**
 * Marca `costeoId` como el costeo utilizado de la cotización. Idempotente: si ya es el único seleccionado no escribe ni audita.
 * Solo mientras la cotización está en Borrador (una cotización enviada conserva su significado comercial).
 */
export async function seleccionarCosteo(
  empresaId: number,
  cotizacionId: number,
  costeoId: number,
  usuario: string | null,
): Promise<ResultadoSeleccionCosteo> {
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const padre = await queryConn<RowDataPacket[]>(
      conn,
      "SELECT id, codigo, estado FROM tms_cotizaciones WHERE empresa_id = ? AND id = ? LIMIT 1 FOR UPDATE",
      [empresaId, cotizacionId],
    );
    if (!padre[0]) throw new ErrorSeleccionCosteo("Cotización no encontrada.", 404);
    if (String(padre[0].estado) !== "Borrador") throw new ErrorSeleccionCosteo(MENSAJE_SELECCION_SOLO_BORRADOR, 409);

    const versiones = await queryConn<RowDataPacket[]>(
      conn,
      "SELECT id, version, es_seleccionado FROM tms_cotizacion_costeos WHERE empresa_id = ? AND cotizacion_id = ? FOR UPDATE",
      [empresaId, cotizacionId],
    );
    const elegida = versiones.find((v) => Number(v.id) === costeoId);
    if (!elegida) throw new ErrorSeleccionCosteo(MENSAJE_COSTEO_NO_ENCONTRADO, 404);
    const version = Number(elegida.version);
    const seleccionadas = versiones.filter((v) => Number(v.es_seleccionado) === 1);
    if (seleccionadas.length === 1 && Number(seleccionadas[0].id) === costeoId) {
      await conn.commit();
      return { costeoId, version, cambio: false };
    }

    // Se limpia la marca de TODAS las demás (también repara un dato anómalo con más de una) y luego se marca la elegida.
    await conn.execute(
      "UPDATE tms_cotizacion_costeos SET es_seleccionado = 0, seleccionado_por = NULL, seleccionado_en = NULL WHERE empresa_id = ? AND cotizacion_id = ? AND es_seleccionado = 1 AND id <> ?",
      [empresaId, cotizacionId, costeoId],
    );
    await conn.execute(
      "UPDATE tms_cotizacion_costeos SET es_seleccionado = 1, seleccionado_por = ?, seleccionado_en = NOW() WHERE empresa_id = ? AND cotizacion_id = ? AND id = ?",
      [usuario, empresaId, cotizacionId, costeoId],
    );
    // Sin montos ni parámetros en el texto: la auditoría es ampliamente visible.
    await registrarAuditoriaTx(conn, {
      empresaId,
      usuario,
      accion: "seleccionar_costeo",
      modulo: "tms_cotizaciones",
      detalle: `Costeo interno versión ${version} seleccionado para cotización ${String(padre[0].codigo)}.`,
    });
    await conn.commit();
    return { costeoId, version, cambio: true };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}
