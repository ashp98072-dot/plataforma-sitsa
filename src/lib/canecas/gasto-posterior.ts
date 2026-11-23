import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';

export type GastoPosterior = {
  compraId: number; importeCentavos: bigint; moneda: string;
  fechaDocumento: string; referencia: string; motivo: string; claveOperacion: string;
};

/** Registra el gasto como pendiente; no actualiza compras, capas ni movimientos. */
export async function registrarGastoPosterior(pool: Pool, empresaId: number, usuarioId: number, dato: GastoPosterior) {
  const { compraId, importeCentavos, moneda, fechaDocumento, referencia, motivo, claveOperacion } = dato;
  const fecha = new Date(`${fechaDocumento}T00:00:00Z`);
  if (![empresaId, usuarioId, compraId].every(n => Number.isSafeInteger(n) && n > 0) ||
      importeCentavos < BigInt("0") || importeCentavos > BigInt("9223372036854775807") || !/^[A-Z]{3}$/.test(moneda) || !/^\d{4}-\d{2}-\d{2}$/.test(fechaDocumento) || !Number.isFinite(fecha.getTime()) || fecha.toISOString().slice(0,10) !== fechaDocumento ||
      !referencia.trim() || referencia.length > 250 || !motivo.trim() || motivo.length > 500 ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(claveOperacion)) throw new Error('GASTO_INVALIDO');
  const conn = await pool.getConnection();
  try {
    await conn.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
    await conn.beginTransaction();
    const [compras] = await conn.query<RowDataPacket[]>('SELECT id,moneda FROM canecas_compras WHERE empresa_id=? AND id=? FOR UPDATE', [empresaId, compraId]);
    if (!compras.length) throw new Error('COMPRA_NO_ENCONTRADA');
    if (compras[0].moneda != null && compras[0].moneda !== moneda) throw new Error('MONEDA_INCOMPATIBLE');
    const [anteriores] = await conn.query<RowDataPacket[]>(
      "SELECT id,compra_id,CAST(importe_centavos AS CHAR) importe,moneda,DATE_FORMAT(fecha_documento,'%Y-%m-%d') fecha_documento,referencia,motivo FROM canecas_gastos_posteriores WHERE empresa_id=? AND clave_operacion=?",
      [empresaId, claveOperacion],
    );
    if (anteriores.length) {
      const a = anteriores[0];
      if (Number(a.compra_id) !== compraId || a.importe !== importeCentavos.toString() || a.moneda !== moneda || a.fecha_documento !== fechaDocumento || a.referencia !== referencia || a.motivo !== motivo) throw new Error('CLAVE_REUTILIZADA');
      await conn.commit();
      return { id: Number(a.id), yaRegistrado: true };
    }
    const [r] = await conn.execute<ResultSetHeader>(
      'INSERT INTO canecas_gastos_posteriores (empresa_id,compra_id,importe_centavos,moneda,fecha_documento,referencia,motivo,clave_operacion,creado_por) VALUES (?,?,?,?,?,?,?,?,?)',
      [empresaId, compraId, importeCentavos.toString(), moneda, fechaDocumento, referencia, motivo, claveOperacion, usuarioId],
    );
    await conn.commit();
    return { id: r.insertId, yaRegistrado: false };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}
