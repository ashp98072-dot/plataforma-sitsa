import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";

/** Confirma una recepción una sola vez. No se modifica el saldo al crear el borrador. */
export async function confirmarRecepcion(pool: Pool, empresaId: number, recepcionId: number, usuarioId: number) {
  const conn = await pool.getConnection();
  try {
    // La lectura inicial solo localiza la compra. READ COMMITTED evita que esa
    // lectura fije una instantánea anterior a la transacción que tiene el bloqueo.
    await conn.query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED");
    await conn.beginTransaction();
    // Bloquear primero la compra serializa las recepciones parciales de esa compra.
    const [referencias] = await conn.query<RowDataPacket[]>(
      "SELECT compra_id FROM canecas_recepciones WHERE empresa_id = ? AND id = ?", [empresaId, recepcionId],
    );
    if (!referencias[0]) throw new Error("RECEPCION_NO_ENCONTRADA");
    const [compras] = await conn.query<RowDataPacket[]>(
      "SELECT id, producto_id, cantidad, referencia FROM canecas_compras WHERE empresa_id = ? AND id = ? FOR UPDATE",
      [empresaId, referencias[0].compra_id],
    );
    const compra = compras[0];
    if (!compra) throw new Error("COMPRA_NO_ENCONTRADA");
    const [recepciones] = await conn.query<RowDataPacket[]>(
      "SELECT id, compra_id, ubicacion_id, cantidad, estado FROM canecas_recepciones WHERE empresa_id = ? AND id = ? FOR UPDATE",
      [empresaId, recepcionId],
    );
    const recepcion = recepciones[0];
    if (!recepcion || recepcion.compra_id !== compra.id) throw new Error("RECEPCION_NO_ENCONTRADA");
    if (recepcion.estado === "CONFIRMADA") {
      await conn.commit();
      return { yaConfirmada: true };
    }
    if (recepcion.estado !== "BORRADOR") throw new Error("ESTADO_INVALIDO");
    const [totales] = await conn.query<RowDataPacket[]>(
      "SELECT COALESCE(SUM(cantidad),0) AS total FROM canecas_recepciones WHERE empresa_id = ? AND compra_id = ? AND estado = 'CONFIRMADA'",
      [empresaId, compra.id],
    );
    if (Number(totales[0].total) + Number(recepcion.cantidad) > Number(compra.cantidad)) throw new Error("CANTIDAD_EXCEDE_COMPRA");
    await conn.execute(
      "INSERT INTO canecas_saldos (empresa_id,producto_id,ubicacion_id,fisico,reservado) VALUES (?,?,?,0,0) ON DUPLICATE KEY UPDATE fisico=fisico",
      [empresaId, compra.producto_id, recepcion.ubicacion_id],
    );
    const [saldos] = await conn.query<RowDataPacket[]>(
      "SELECT fisico FROM canecas_saldos WHERE empresa_id=? AND producto_id=? AND ubicacion_id=? FOR UPDATE",
      [empresaId, compra.producto_id, recepcion.ubicacion_id],
    );
    if (Number(saldos[0].fisico) + Number(recepcion.cantidad) > 2147483647) throw new Error("SALDO_EXCEDE_LIMITE");
    await conn.execute(
      "UPDATE canecas_saldos SET fisico=fisico+? WHERE empresa_id=? AND producto_id=? AND ubicacion_id=?",
      [recepcion.cantidad, empresaId, compra.producto_id, recepcion.ubicacion_id],
    );
    await conn.execute<ResultSetHeader>(
      "INSERT INTO canecas_movimientos (empresa_id,producto_id,ubicacion_id,tipo,cantidad,recepcion_id,documento,usuario_id) VALUES (?,?,?,'ENTRADA',?,?,?,?)",
      [empresaId, compra.producto_id, recepcion.ubicacion_id, recepcion.cantidad, recepcionId, compra.referencia, usuarioId],
    );
    await conn.execute(
      "UPDATE canecas_recepciones SET estado='CONFIRMADA',confirmado_por=?,confirmado_en=CURRENT_TIMESTAMP WHERE empresa_id=? AND id=?",
      [usuarioId, empresaId, recepcionId],
    );
    await conn.commit();
    return { yaConfirmada: false };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}
