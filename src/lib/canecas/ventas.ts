import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { ejecutarSalidaFifo, ejecutarReversoSalidaFifo } from './salidas-fifo';
import { calcularVenta, formatearQuetzales, precioACentavos, validarCantidadVenta, validarFechaVenta } from './ventas-reglas';

export type DatosVenta = { clienteId: number; productoId: number; ubicacionId: number; fechaVenta: string; documento: string; cantidad: number; precio: string; claveOperacion: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const entero = (n: number) => Number.isSafeInteger(n) && n > 0 && n <= 2147483647;

function resumen(totalCentavos: bigint, costoCentavos: bigint) {
  const utilidadCentavos = totalCentavos - costoCentavos;
  return { total: formatearQuetzales(totalCentavos), costo: formatearQuetzales(costoCentavos), utilidad: formatearQuetzales(utilidadCentavos), totalCentavos: totalCentavos.toString(), costoCentavos: costoCentavos.toString(), utilidadCentavos: utilidadCentavos.toString() };
}

/**
 * Venta comercial: valida al cliente (de la empresa y activo), descuenta el inventario por FIFO y registra la venta con el
 * costo FIFO real, todo en UNA transacción. Reintentos con la misma clave devuelven la misma venta; con otros datos, error.
 * Una venta nunca se borra: se anula (anularVenta). Sin costo conocido en las capas a consumir la venta se rechaza.
 */
export async function registrarVenta(pool: Pool, empresaId: number, usuarioId: number, dato: DatosVenta, hoy = new Date().toISOString().slice(0, 10)) {
  if (![empresaId, usuarioId, dato.clienteId, dato.productoId, dato.ubicacionId].every(entero) || !dato.documento.trim() || dato.documento.length > 250 || !UUID.test(dato.claveOperacion)) throw Error('VENTA_INVALIDA');
  const cantidad = validarCantidadVenta(dato.cantidad), fecha = validarFechaVenta(dato.fechaVenta, hoy), precio = precioACentavos(dato.precio);
  const conn = await pool.getConnection();
  try {
    await conn.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
    await conn.beginTransaction();
    // Devuelve la venta ya registrada con esta clave (si los datos coinciden) o null; con otros datos, error.
    const buscarPrevia = async () => {
      const [previas] = await conn.query<RowDataPacket[]>('SELECT id,cliente_id,producto_id,ubicacion_id,DATE_FORMAT(fecha_venta,\'%Y-%m-%d\') fecha,documento,cantidad,CAST(precio_unitario_centavos AS CHAR) precio,CAST(total_centavos AS CHAR) total,CAST(costo_centavos AS CHAR) costo FROM canecas_ventas WHERE empresa_id=? AND clave_operacion=?', [empresaId, dato.claveOperacion]);
      const p = previas[0];
      if (!p) return null;
      if (Number(p.cliente_id) !== dato.clienteId || Number(p.producto_id) !== dato.productoId || Number(p.ubicacion_id) !== dato.ubicacionId || p.fecha !== fecha || p.documento !== dato.documento || Number(p.cantidad) !== cantidad || p.precio !== precio.toString()) throw Error('CLAVE_REUTILIZADA');
      return { id: String(p.id), ...resumen(BigInt(p.total), BigInt(p.costo)), yaRegistrada: true };
    };
    const previa = await buscarPrevia();
    if (previa) { await conn.commit(); return previa; }
    // El cliente debe ser de la empresa y estar activo; se protege contra su desactivación concurrente.
    const [clientes] = await conn.query<RowDataPacket[]>('SELECT activo FROM canecas_clientes WHERE empresa_id=? AND id=? LOCK IN SHARE MODE', [empresaId, dato.clienteId]);
    if (!clientes[0] || Number(clientes[0].activo) !== 1) throw Error('CLIENTE_INVALIDO');
    const salida = await ejecutarSalidaFifo(conn, empresaId, usuarioId, { productoId: dato.productoId, ubicacionId: dato.ubicacionId, cantidad, documento: dato.documento, claveOperacion: dato.claveOperacion });
    if (salida.yaRegistrada) {
      // Reintento concurrente con la misma clave: la venta ya se confirmó mientras esperábamos el bloqueo del inventario.
      // Si la clave pertenece a una salida de inventario que no es venta, no se reutiliza.
      const concurrente = await buscarPrevia();
      if (!concurrente) throw Error('CLAVE_REUTILIZADA');
      await conn.commit();
      return concurrente;
    }
    if (salida.moneda !== 'GTQ') throw Error('MONEDA_INCOMPATIBLE');
    const calculo = calcularVenta(precio, cantidad, BigInt(salida.costoCentavos));
    const [venta] = await conn.execute<ResultSetHeader>('INSERT INTO canecas_ventas (empresa_id,cliente_id,producto_id,ubicacion_id,fecha_venta,documento,cantidad,precio_unitario_centavos,total_centavos,costo_centavos,moneda,salida_id,clave_operacion,creado_por) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [empresaId, dato.clienteId, dato.productoId, dato.ubicacionId, fecha, dato.documento, cantidad, precio.toString(), calculo.totalCentavos.toString(), calculo.costoCentavos.toString(), 'GTQ', salida.id, dato.claveOperacion, usuarioId]);
    await conn.commit();
    return { id: String(venta.insertId), ...resumen(calculo.totalCentavos, calculo.costoCentavos), yaRegistrada: false };
  } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
}

/**
 * Anula una venta: reversa su salida FIFO (restaura exactamente las capas y el inventario) y marca la venta como ANULADA con
 * motivo y responsable. No se borra nada. Reintentar con el mismo motivo es idempotente.
 */
export async function anularVenta(pool: Pool, empresaId: number, usuarioId: number, ventaId: string, motivo: string) {
  if (!/^[1-9][0-9]{0,18}$/.test(ventaId) || !motivo.trim() || motivo.length > 500 || !entero(empresaId) || !entero(usuarioId)) throw Error('ANULACION_INVALIDA');
  const conn = await pool.getConnection();
  try {
    await conn.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
    await conn.beginTransaction();
    const [ventas] = await conn.query<RowDataPacket[]>('SELECT id,estado,salida_id,motivo_anulacion FROM canecas_ventas WHERE empresa_id=? AND id=? FOR UPDATE', [empresaId, ventaId]);
    const venta = ventas[0];
    if (!venta) throw Error('VENTA_NO_ENCONTRADA');
    if (venta.estado === 'ANULADA') {
      if (venta.motivo_anulacion !== motivo) throw Error('ANULACION_YA_REGISTRADA');
      await conn.commit(); return { yaAnulada: true };
    }
    await ejecutarReversoSalidaFifo(conn, empresaId, usuarioId, String(venta.salida_id), motivo);
    await conn.execute("UPDATE canecas_ventas SET estado='ANULADA',anulada_por=?,anulada_en=CURRENT_TIMESTAMP,motivo_anulacion=? WHERE empresa_id=? AND id=? AND estado='ACTIVA'", [usuarioId, motivo, empresaId, ventaId]);
    await conn.commit();
    return { yaAnulada: false };
  } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
}

/** Una salida enlazada a una venta solo puede revertirse anulando la venta (si no, la venta seguiría contando ingresos). */
export async function salidaPerteneceAVenta(pool: Pool, empresaId: number, salidaId: string) {
  if (!/^[1-9][0-9]{0,18}$/.test(salidaId) || !entero(empresaId)) return false;
  const [rows] = await pool.query<RowDataPacket[]>('SELECT 1 AS x FROM canecas_ventas WHERE empresa_id=? AND salida_id=? LIMIT 1', [empresaId, salidaId]);
  return rows.length > 0;
}
