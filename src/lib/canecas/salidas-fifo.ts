import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { consultarCapasFifo } from './orden-fifo';

type Salida = { productoId: number; ubicacionId: number; cantidad: number; documento: string; claveOperacion: string };

/** Descuenta físico y capas en una sola transacción serializada por saldo. */
export async function registrarSalidaFifo(pool: Pool, empresaId: number, usuarioId: number, dato: Salida) {
  if (![empresaId, usuarioId, dato.productoId, dato.ubicacionId, dato.cantidad].every(x => Number.isSafeInteger(x) && x > 0 && x <= 2147483647) || !dato.documento.trim() || dato.documento.length > 250 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(dato.claveOperacion)) throw Error('SALIDA_INVALIDA');
  const conn = await pool.getConnection();
  try {
    await conn.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
    await conn.beginTransaction();
    const resultado = await ejecutarSalidaFifo(conn, empresaId, usuarioId, dato);
    await conn.commit();
    return resultado;
  } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
}

/** Versión para ejecutarse dentro de una transacción ya abierta por el llamador (READ COMMITTED); no confirma ni revierte. */
export async function ejecutarSalidaFifo(conn: PoolConnection, empresaId: number, usuarioId: number, dato: Salida) {
  if (![empresaId, usuarioId, dato.productoId, dato.ubicacionId, dato.cantidad].every(x => Number.isSafeInteger(x) && x > 0 && x <= 2147483647) || !dato.documento.trim() || dato.documento.length > 250 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(dato.claveOperacion)) throw Error('SALIDA_INVALIDA');
    const [saldos] = await conn.query<RowDataPacket[]>('SELECT s.fisico,s.reservado,p.activo AS producto_activo,u.activo AS ubicacion_activa FROM canecas_saldos s JOIN canecas_productos p ON p.empresa_id=s.empresa_id AND p.id=s.producto_id JOIN canecas_ubicaciones u ON u.empresa_id=s.empresa_id AND u.id=s.ubicacion_id WHERE s.empresa_id=? AND s.producto_id=? AND s.ubicacion_id=? FOR UPDATE', [empresaId, dato.productoId, dato.ubicacionId]);
    if (!saldos[0]) throw Error('SALDO_NO_ENCONTRADO');
    const [previas] = await conn.query<RowDataPacket[]>('SELECT id,producto_id,ubicacion_id,cantidad,documento,CAST(costo_centavos AS CHAR) costo,moneda FROM canecas_salidas_fifo WHERE empresa_id=? AND clave_operacion=?', [empresaId, dato.claveOperacion]);
    if (previas[0]) {
      const p = previas[0];
      if (Number(p.producto_id) !== dato.productoId || Number(p.ubicacion_id) !== dato.ubicacionId || Number(p.cantidad) !== dato.cantidad || p.documento !== dato.documento) throw Error('CLAVE_REUTILIZADA');
      return { id: String(p.id), costoCentavos: p.costo as string, moneda: p.moneda as string, yaRegistrada: true };
    }
    if (Number(saldos[0].producto_activo) !== 1 || Number(saldos[0].ubicacion_activa) !== 1) throw Error('REFERENCIA_INVALIDA');
    // Las reservas aún no están asignadas a capas concretas. Consumir FIFO mientras
    // exista cualquier reserva podría descontar precisamente una unidad reservada.
    if (Number(saldos[0].reservado) > 0) throw Error('RESERVAS_PENDIENTES');
    if (Number(saldos[0].fisico) < dato.cantidad) throw Error('SALDO_INSUFICIENTE');
    const capas = await consultarCapasFifo(conn, orden => `SELECT id,cantidad_disponible,valoracion_id,CAST(costo_unitario_centavos AS CHAR) costo,moneda FROM canecas_capas_costo WHERE empresa_id=? AND producto_id=? AND ubicacion_id=? AND cantidad_disponible>0 ORDER BY ${orden} FOR UPDATE`, [empresaId, dato.productoId, dato.ubicacionId]);
    if (capas.reduce((n, c) => n + Number(c.cantidad_disponible), 0) !== Number(saldos[0].fisico)) throw Error('CAPAS_NO_CONCILIADAS');
    // Una valoración inicial de edad desconocida podría preceder a cualquier recepción.
    if (capas.some(c => c.valoracion_id != null)) throw Error('PRIORIDAD_INICIAL_PENDIENTE');
    let pendiente = dato.cantidad, total = BigInt('0'), moneda: string | null = null;
    const partes: { id: string; cantidad: number; costo: string }[] = [];
    for (const capa of capas) {
      if (!pendiente) break;
      if (capa.costo == null || !capa.moneda) throw Error('COSTO_PENDIENTE');
      if (moneda !== null && moneda !== capa.moneda) throw Error('MONEDA_INCOMPATIBLE');
      moneda = capa.moneda;
      const cantidad = Math.min(pendiente, Number(capa.cantidad_disponible));
      partes.push({ id: String(capa.id), cantidad, costo: String(capa.costo) });
      total += BigInt(capa.costo) * BigInt(cantidad);
      pendiente -= cantidad;
    }
    if (pendiente || !moneda) throw Error('CAPAS_INSUFICIENTES');
    const [mov] = await conn.execute<ResultSetHeader>("INSERT INTO canecas_movimientos (empresa_id,producto_id,ubicacion_id,tipo,cantidad,documento,usuario_id) VALUES (?,?,?,'SALIDA',?,?,?)", [empresaId, dato.productoId, dato.ubicacionId, -dato.cantidad, dato.documento, usuarioId]);
    const [salida] = await conn.execute<ResultSetHeader>('INSERT INTO canecas_salidas_fifo (empresa_id,producto_id,ubicacion_id,cantidad,documento,clave_operacion,movimiento_id,costo_centavos,moneda,creado_por) VALUES (?,?,?,?,?,?,?,?,?,?)', [empresaId, dato.productoId, dato.ubicacionId, dato.cantidad, dato.documento, dato.claveOperacion, mov.insertId, total.toString(), moneda, usuarioId]);
    for (const parte of partes) {
      await conn.execute('UPDATE canecas_capas_costo SET cantidad_disponible=cantidad_disponible-? WHERE empresa_id=? AND id=?', [parte.cantidad, empresaId, parte.id]);
      await conn.execute('INSERT INTO canecas_salidas_fifo_capas (empresa_id,salida_id,capa_id,cantidad,costo_unitario_centavos,moneda) VALUES (?,?,?,?,?,?)', [empresaId, salida.insertId, parte.id, parte.cantidad, parte.costo, moneda]);
    }
    await conn.execute('UPDATE canecas_saldos SET fisico=fisico-? WHERE empresa_id=? AND producto_id=? AND ubicacion_id=?', [dato.cantidad, empresaId, dato.productoId, dato.ubicacionId]);
    return { id: String(salida.insertId), costoCentavos: total.toString(), moneda, yaRegistrada: false };
}


/** Reintegra exactamente las capas históricas y crea un movimiento inverso. */
export async function reversarSalidaFifo(pool: Pool, empresaId: number, usuarioId: number, salidaId: string, motivo: string) {
  if (!/^[1-9][0-9]{0,18}$/.test(salidaId) || !motivo.trim() || motivo.length > 500 || !Number.isSafeInteger(empresaId) || empresaId <= 0 || !Number.isSafeInteger(usuarioId) || usuarioId <= 0) throw Error('REVERSO_INVALIDO');
  const conn = await pool.getConnection();
  try {
    await conn.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
    await conn.beginTransaction();
    const resultado = await ejecutarReversoSalidaFifo(conn, empresaId, usuarioId, salidaId, motivo);
    await conn.commit();
    return resultado;
  } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
}

/** Versión para ejecutarse dentro de una transacción ya abierta por el llamador (READ COMMITTED); no confirma ni revierte. */
export async function ejecutarReversoSalidaFifo(conn: PoolConnection, empresaId: number, usuarioId: number, salidaId: string, motivo: string) {
  if (!/^[1-9][0-9]{0,18}$/.test(salidaId) || !motivo.trim() || motivo.length > 500 || !Number.isSafeInteger(empresaId) || empresaId <= 0 || !Number.isSafeInteger(usuarioId) || usuarioId <= 0) throw Error('REVERSO_INVALIDO');
    const [salidas] = await conn.query<RowDataPacket[]>('SELECT * FROM canecas_salidas_fifo WHERE empresa_id=? AND id=? FOR UPDATE', [empresaId, salidaId]);
    const salida = salidas[0];
    if (!salida) throw Error('SALIDA_NO_ENCONTRADA');
    if (salida.reversado_en != null) {
      if (salida.motivo_reverso !== motivo) throw Error('REVERSO_YA_REGISTRADO');
      return { yaReversada: true };
    }
    const [saldos] = await conn.query<RowDataPacket[]>('SELECT fisico FROM canecas_saldos WHERE empresa_id=? AND producto_id=? AND ubicacion_id=? FOR UPDATE', [empresaId, salida.producto_id, salida.ubicacion_id]);
    if (!saldos[0] || Number(saldos[0].fisico) + Number(salida.cantidad) > 2147483647) throw Error('SALDO_INVALIDO');
    const [partes] = await conn.query<RowDataPacket[]>('SELECT d.capa_id,d.cantidad,c.cantidad_disponible,c.cantidad_inicial,c.producto_id,c.ubicacion_id FROM canecas_salidas_fifo_capas d JOIN canecas_capas_costo c ON c.empresa_id=d.empresa_id AND c.id=d.capa_id WHERE d.empresa_id=? AND d.salida_id=? ORDER BY c.id FOR UPDATE', [empresaId, salidaId]);
    if (!partes.length || partes.reduce((n, p) => n + Number(p.cantidad), 0) !== Number(salida.cantidad) || partes.some(p => p.producto_id !== salida.producto_id || p.ubicacion_id !== salida.ubicacion_id || Number(p.cantidad_disponible) + Number(p.cantidad) > Number(p.cantidad_inicial))) throw Error('TRAZABILIDAD_INVALIDA');
    for (const parte of partes) await conn.execute('UPDATE canecas_capas_costo SET cantidad_disponible=cantidad_disponible+? WHERE empresa_id=? AND id=?', [parte.cantidad, empresaId, parte.capa_id]);
    await conn.execute('UPDATE canecas_saldos SET fisico=fisico+? WHERE empresa_id=? AND producto_id=? AND ubicacion_id=?', [salida.cantidad, empresaId, salida.producto_id, salida.ubicacion_id]);
    const [mov] = await conn.execute<ResultSetHeader>("INSERT INTO canecas_movimientos (empresa_id,producto_id,ubicacion_id,tipo,cantidad,movimiento_reversado_id,documento,motivo,usuario_id) VALUES (?,?,?,'REVERSO',?,?,?,?,?)", [empresaId, salida.producto_id, salida.ubicacion_id, salida.cantidad, salida.movimiento_id, salida.documento, motivo, usuarioId]);
    await conn.execute('UPDATE canecas_salidas_fifo SET reversado_por=?,reversado_en=CURRENT_TIMESTAMP,motivo_reverso=?,movimiento_reverso_id=? WHERE empresa_id=? AND id=?', [usuarioId, motivo, mov.insertId, empresaId, salidaId]);
    return { yaReversada: false };
}

