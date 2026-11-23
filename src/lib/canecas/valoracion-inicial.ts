import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';

export type ValoracionInicial = {
  productoId: number; ubicacionId: number; cantidad: number;
  costoCentavos: bigint | null; moneda: string | null;
  documento: string; motivo: string; claveOperacion: string;
};

/** No altera el saldo: documenta únicamente unidades existentes que todavía no tienen capa. */
export async function valorarExistenciaInicial(pool: Pool, empresaId: number, usuarioId: number, dato: ValoracionInicial) {
  const { productoId, ubicacionId, cantidad, costoCentavos, moneda, documento, motivo, claveOperacion } = dato;
  if (![empresaId, usuarioId, productoId, ubicacionId, cantidad].every(n => Number.isSafeInteger(n) && n > 0) ||
      cantidad > 2147483647 || costoCentavos === null || (costoCentavos !== null && (costoCentavos < BigInt("0") || costoCentavos > BigInt("9223372036854775807"))) ||
      (costoCentavos !== null && (!moneda || !/^[A-Z]{3}$/.test(moneda))) ||
      (moneda !== null && !/^[A-Z]{3}$/.test(moneda)) ||
      !documento.trim() || documento.length > 250 || !motivo.trim() || motivo.length > 500 ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(claveOperacion)) {
    throw new Error('VALORACION_INVALIDA');
  }
  const conn = await pool.getConnection();
  try {
    await conn.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
    await conn.beginTransaction();
    const [saldos] = await conn.query<RowDataPacket[]>(
      'SELECT fisico FROM canecas_saldos WHERE empresa_id=? AND producto_id=? AND ubicacion_id=? FOR UPDATE',
      [empresaId, productoId, ubicacionId],
    );
    if (!saldos.length) throw new Error('SALDO_NO_ENCONTRADO');
    const [anteriores] = await conn.query<RowDataPacket[]>(
      'SELECT producto_id,ubicacion_id,cantidad,CAST(costo_unitario_centavos AS CHAR) costo,moneda,documento,motivo FROM canecas_valoraciones_iniciales WHERE empresa_id=? AND clave_operacion=?',
      [empresaId, claveOperacion],
    );
    if (anteriores.length) {
      const a = anteriores[0];
      if (Number(a.producto_id) !== productoId || Number(a.ubicacion_id) !== ubicacionId || Number(a.cantidad) !== cantidad ||
          a.costo !== (costoCentavos?.toString() ?? null) || a.moneda !== moneda || a.documento !== documento || a.motivo !== motivo) throw new Error('CLAVE_REUTILIZADA');
      await conn.commit();
      return { yaRegistrada: true };
    }
    const [capas] = await conn.query<RowDataPacket[]>(
      'SELECT COALESCE(SUM(cantidad_disponible),0) AS total FROM canecas_capas_costo WHERE empresa_id=? AND producto_id=? AND ubicacion_id=?',
      [empresaId, productoId, ubicacionId],
    );
    const sinCapa = Number(saldos[0].fisico) - Number(capas[0].total);
    if (sinCapa < 0 || cantidad > sinCapa) throw new Error('CONCILIACION_INVALIDA');
    const [registro] = await conn.execute<ResultSetHeader>(
      'INSERT INTO canecas_valoraciones_iniciales (empresa_id,producto_id,ubicacion_id,cantidad,costo_unitario_centavos,moneda,documento,motivo,clave_operacion,creado_por) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [empresaId, productoId, ubicacionId, cantidad, costoCentavos?.toString() ?? null, moneda, documento, motivo, claveOperacion, usuarioId],
    );
    await conn.execute(
      'INSERT INTO canecas_capas_costo (empresa_id,producto_id,ubicacion_id,valoracion_id,segmento,cantidad_inicial,cantidad_disponible,costo_unitario_centavos,moneda) VALUES (?,?,?,?,0,?,?,?,?)',
      [empresaId, productoId, ubicacionId, registro.insertId, cantidad, cantidad, costoCentavos?.toString() ?? null, moneda],
    );
    await conn.commit();
    return { yaRegistrada: false };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}
