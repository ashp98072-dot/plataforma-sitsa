import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { repartirRedistribucion, type CapaOrigen } from './redistribucion-reglas';
import { ORDEN_FIFO, PRIORIDAD_FIFO } from './orden-fifo';

type Redistribucion = { compraId: number; ubicacionId: number; cantidadResultante: number; documento: string; motivo: string; claveOperacion: string };
const MAX_INT = 2147483647;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Redistribuye el lote disponible de una compra en una ubicación: retira sus capas de
 * origen y abre capas nuevas con el mismo costo total, la antigüedad del lote original y
 * trazabilidad completa. No crea compras ni recepciones. El resultado puede ser mayor
 * (extras), igual o menor (merma) que el origen; el costo total siempre se conserva.
 * Orden de bloqueos: compra → saldo → capas (consistente con confirmarRecepcion).
 */
export async function registrarRedistribucion(pool: Pool, empresaId: number, usuarioId: number, dato: Redistribucion) {
  if (![empresaId, usuarioId, dato.compraId, dato.ubicacionId, dato.cantidadResultante].every(x => Number.isSafeInteger(x) && x > 0 && x <= MAX_INT) || !dato.documento.trim() || dato.documento.length > 250 || !dato.motivo.trim() || dato.motivo.length > 500 || !UUID.test(dato.claveOperacion)) throw Error('REDISTRIBUCION_INVALIDA');
  const conn = await pool.getConnection();
  try {
    await conn.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
    await conn.beginTransaction();
    const [compras] = await conn.query<RowDataPacket[]>('SELECT id,producto_id FROM canecas_compras WHERE empresa_id=? AND id=? FOR UPDATE', [empresaId, dato.compraId]);
    if (!compras[0]) throw Error('COMPRA_NO_ENCONTRADA');
    const productoId = Number(compras[0].producto_id);
    const [previas] = await conn.query<RowDataPacket[]>('SELECT id,compra_id,ubicacion_id,cantidad_resultante,documento,motivo,CAST(costo_total_centavos AS CHAR) costo,moneda FROM canecas_redistribuciones WHERE empresa_id=? AND clave_operacion=?', [empresaId, dato.claveOperacion]);
    if (previas[0]) {
      const p = previas[0];
      if (Number(p.compra_id) !== dato.compraId || Number(p.ubicacion_id) !== dato.ubicacionId || Number(p.cantidad_resultante) !== dato.cantidadResultante || p.documento !== dato.documento || p.motivo !== dato.motivo) throw Error('CLAVE_REUTILIZADA');
      await conn.commit();
      return { id: String(p.id), costoTotalCentavos: p.costo as string, moneda: p.moneda as string, yaRegistrada: true };
    }
    const [saldos] = await conn.query<RowDataPacket[]>('SELECT s.fisico,s.reservado,p.activo AS producto_activo,u.activo AS ubicacion_activa FROM canecas_saldos s JOIN canecas_productos p ON p.empresa_id=s.empresa_id AND p.id=s.producto_id JOIN canecas_ubicaciones u ON u.empresa_id=s.empresa_id AND u.id=s.ubicacion_id WHERE s.empresa_id=? AND s.producto_id=? AND s.ubicacion_id=? FOR UPDATE', [empresaId, productoId, dato.ubicacionId]);
    if (!saldos[0]) throw Error('SALDO_NO_ENCONTRADO');
    if (Number(saldos[0].producto_activo) !== 1 || Number(saldos[0].ubicacion_activa) !== 1) throw Error('REFERENCIA_INVALIDA');
    // Las reservas no están asignadas a capas concretas: no se puede reducir ni mover lotes con reservas.
    if (Number(saldos[0].reservado) > 0) throw Error('RESERVAS_PENDIENTES');
    const [capas] = await conn.query<RowDataPacket[]>(`SELECT id,cantidad_disponible,CAST(costo_unitario_centavos AS CHAR) costo,moneda,CAST(${PRIORIDAD_FIFO} AS CHAR) AS orden,DATE_FORMAT(creado_en,'%Y-%m-%d %H:%i:%s') AS creado_txt FROM canecas_capas_costo WHERE empresa_id=? AND producto_id=? AND ubicacion_id=? AND cantidad_disponible>0 ORDER BY ${ORDEN_FIFO} FOR UPDATE`, [empresaId, productoId, dato.ubicacionId]);
    if (capas.reduce((n, c) => n + Number(c.cantidad_disponible), 0) !== Number(saldos[0].fisico)) throw Error('CAPAS_NO_CONCILIADAS');
    // Lote = capas disponibles cuya compra (directa o heredada de otra redistribución) es la indicada.
    const [lote] = await conn.query<RowDataPacket[]>('SELECT c.id FROM canecas_capas_costo c LEFT JOIN canecas_recepciones r ON r.empresa_id=c.empresa_id AND r.id=c.recepcion_id LEFT JOIN canecas_redistribuciones d ON d.empresa_id=c.empresa_id AND d.id=c.redistribucion_id WHERE c.empresa_id=? AND c.producto_id=? AND c.ubicacion_id=? AND c.cantidad_disponible>0 AND COALESCE(r.compra_id,d.compra_id)=?', [empresaId, productoId, dato.ubicacionId, dato.compraId]);
    const idsLote = new Set(lote.map(l => String(l.id)));
    const origenes = capas.filter(c => idsLote.has(String(c.id)));
    if (!origenes.length) throw Error('CAPAS_INSUFICIENTES');
    if (origenes.some(c => c.costo == null || !c.moneda)) throw Error('COSTO_PENDIENTE');
    const moneda = String(origenes[0].moneda);
    if (origenes.some(c => String(c.moneda) !== moneda)) throw Error('MONEDA_INCOMPATIBLE');
    const entrada: CapaOrigen[] = origenes.map(c => ({ capaId: String(c.id), cantidad: Number(c.cantidad_disponible), creadoEn: String(c.creado_txt), orden: BigInt(c.orden), costoUnitarioCentavos: BigInt(c.costo) }));
    const reparto = repartirRedistribucion(entrada, dato.cantidadResultante);
    const diferencia = dato.cantidadResultante - reparto.cantidadOrigen;
    const nuevoFisico = Number(saldos[0].fisico) + diferencia;
    if (nuevoFisico < 0 || nuevoFisico > MAX_INT) throw Error('SALDO_INVALIDO');
    let movimientoId: number | null = null;
    if (diferencia !== 0) {
      const [mov] = await conn.execute<ResultSetHeader>("INSERT INTO canecas_movimientos (empresa_id,producto_id,ubicacion_id,tipo,cantidad,documento,motivo,usuario_id) VALUES (?,?,?,'REDISTRIBUCION',?,?,?,?)", [empresaId, productoId, dato.ubicacionId, diferencia, dato.documento, dato.motivo, usuarioId]);
      movimientoId = mov.insertId;
    }
    const [redis] = await conn.execute<ResultSetHeader>('INSERT INTO canecas_redistribuciones (empresa_id,compra_id,producto_id,ubicacion_id,cantidad_origen,cantidad_resultante,diferencia,costo_total_centavos,moneda,documento,motivo,clave_operacion,movimiento_id,creado_por) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [empresaId, dato.compraId, productoId, dato.ubicacionId, reparto.cantidadOrigen, dato.cantidadResultante, diferencia, reparto.costoTotalCentavos.toString(), moneda, dato.documento, dato.motivo, dato.claveOperacion, movimientoId, usuarioId]);
    for (const o of entrada) {
      await conn.execute('INSERT INTO canecas_redistribuciones_origen (empresa_id,redistribucion_id,capa_id,cantidad,costo_unitario_centavos,moneda) VALUES (?,?,?,?,?,?)', [empresaId, redis.insertId, o.capaId, o.cantidad, o.costoUnitarioCentavos.toString(), moneda]);
      await conn.execute('UPDATE canecas_capas_costo SET cantidad_disponible=0 WHERE empresa_id=? AND id=?', [empresaId, o.capaId]);
    }
    for (const [segmento, s] of reparto.segmentos.entries()) {
      await conn.execute('INSERT INTO canecas_capas_costo (empresa_id,producto_id,ubicacion_id,redistribucion_id,orden_fifo,segmento,cantidad_inicial,cantidad_disponible,costo_unitario_centavos,moneda,creado_en) VALUES (?,?,?,?,?,?,?,?,?,?,?)', [empresaId, productoId, dato.ubicacionId, redis.insertId, s.ordenFifo.toString(), segmento, s.cantidad, s.cantidad, s.costoUnitarioCentavos.toString(), moneda, s.creadoEn]);
    }
    await conn.execute('UPDATE canecas_saldos SET fisico=? WHERE empresa_id=? AND producto_id=? AND ubicacion_id=?', [nuevoFisico, empresaId, productoId, dato.ubicacionId]);
    // Conciliación final dentro de la misma transacción: nada se confirma si el costo no coincide.
    const [conc] = await conn.query<RowDataPacket[]>('SELECT CAST(COALESCE(SUM(cantidad_inicial),0) AS CHAR) AS unidades,CAST(COALESCE(SUM(CAST(costo_unitario_centavos AS DECIMAL(38,0))*cantidad_inicial),0) AS CHAR) AS costo FROM canecas_capas_costo WHERE empresa_id=? AND redistribucion_id=?', [empresaId, redis.insertId]);
    if (conc[0].unidades !== String(dato.cantidadResultante) || conc[0].costo !== reparto.costoTotalCentavos.toString()) throw Error('CONCILIACION_INVALIDA');
    await conn.commit();
    return { id: String(redis.insertId), costoTotalCentavos: reparto.costoTotalCentavos.toString(), moneda, cantidadOrigen: reparto.cantidadOrigen, cantidadResultante: dato.cantidadResultante, diferencia, yaRegistrada: false };
  } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
}

/**
 * Reversa una redistribución restaurando exactamente las capas de origen. Solo es posible si
 * ninguna capa resultante se ha consumido ni vuelto a redistribuir; en ese caso hay que
 * revertir primero las salidas o redistribuciones posteriores.
 */
export async function reversarRedistribucion(pool: Pool, empresaId: number, usuarioId: number, redistribucionId: string, motivo: string) {
  if (!/^[1-9][0-9]{0,18}$/.test(redistribucionId) || !motivo.trim() || motivo.length > 500 || !Number.isSafeInteger(empresaId) || empresaId <= 0 || !Number.isSafeInteger(usuarioId) || usuarioId <= 0) throw Error('REVERSO_INVALIDO');
  const conn = await pool.getConnection();
  try {
    await conn.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
    await conn.beginTransaction();
    const [filas] = await conn.query<RowDataPacket[]>('SELECT * FROM canecas_redistribuciones WHERE empresa_id=? AND id=? FOR UPDATE', [empresaId, redistribucionId]);
    const redis = filas[0];
    if (!redis) throw Error('REDISTRIBUCION_NO_ENCONTRADA');
    if (redis.reversado_en != null) {
      if (redis.motivo_reverso !== motivo) throw Error('REVERSO_YA_REGISTRADO');
      await conn.commit(); return { yaReversada: true };
    }
    const [saldos] = await conn.query<RowDataPacket[]>('SELECT fisico,reservado FROM canecas_saldos WHERE empresa_id=? AND producto_id=? AND ubicacion_id=? FOR UPDATE', [empresaId, redis.producto_id, redis.ubicacion_id]);
    if (!saldos[0]) throw Error('SALDO_INVALIDO');
    if (Number(saldos[0].reservado) > 0) throw Error('RESERVAS_PENDIENTES');
    const [nuevas] = await conn.query<RowDataPacket[]>('SELECT id,cantidad_inicial,cantidad_disponible FROM canecas_capas_costo WHERE empresa_id=? AND redistribucion_id=? ORDER BY id FOR UPDATE', [empresaId, redistribucionId]);
    if (!nuevas.length || nuevas.some(c => Number(c.cantidad_disponible) !== Number(c.cantidad_inicial)) || nuevas.reduce((n, c) => n + Number(c.cantidad_inicial), 0) !== Number(redis.cantidad_resultante)) throw Error('REDISTRIBUCION_CONSUMIDA');
    const [origen] = await conn.query<RowDataPacket[]>('SELECT o.capa_id,o.cantidad,c.cantidad_disponible,c.cantidad_inicial FROM canecas_redistribuciones_origen o JOIN canecas_capas_costo c ON c.empresa_id=o.empresa_id AND c.id=o.capa_id WHERE o.empresa_id=? AND o.redistribucion_id=? ORDER BY c.id FOR UPDATE', [empresaId, redistribucionId]);
    if (!origen.length || origen.reduce((n, o) => n + Number(o.cantidad), 0) !== Number(redis.cantidad_origen) || origen.some(o => Number(o.cantidad_disponible) + Number(o.cantidad) > Number(o.cantidad_inicial))) throw Error('TRAZABILIDAD_INVALIDA');
    const nuevoFisico = Number(saldos[0].fisico) - Number(redis.diferencia);
    if (nuevoFisico < 0 || nuevoFisico > MAX_INT) throw Error('SALDO_INVALIDO');
    for (const c of nuevas) await conn.execute('UPDATE canecas_capas_costo SET cantidad_disponible=0 WHERE empresa_id=? AND id=?', [empresaId, c.id]);
    for (const o of origen) await conn.execute('UPDATE canecas_capas_costo SET cantidad_disponible=cantidad_disponible+? WHERE empresa_id=? AND id=?', [o.cantidad, empresaId, o.capa_id]);
    await conn.execute('UPDATE canecas_saldos SET fisico=? WHERE empresa_id=? AND producto_id=? AND ubicacion_id=?', [nuevoFisico, empresaId, redis.producto_id, redis.ubicacion_id]);
    let reversoId: number | null = null;
    if (redis.movimiento_id != null) {
      const [mov] = await conn.execute<ResultSetHeader>("INSERT INTO canecas_movimientos (empresa_id,producto_id,ubicacion_id,tipo,cantidad,movimiento_reversado_id,documento,motivo,usuario_id) VALUES (?,?,?,'REVERSO',?,?,?,?,?)", [empresaId, redis.producto_id, redis.ubicacion_id, -Number(redis.diferencia), redis.movimiento_id, redis.documento, motivo, usuarioId]);
      reversoId = mov.insertId;
    }
    await conn.execute('UPDATE canecas_redistribuciones SET reversado_por=?,reversado_en=CURRENT_TIMESTAMP,motivo_reverso=?,movimiento_reverso_id=? WHERE empresa_id=? AND id=?', [usuarioId, motivo, reversoId, empresaId, redistribucionId]);
    await conn.commit(); return { yaReversada: false };
  } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
}
