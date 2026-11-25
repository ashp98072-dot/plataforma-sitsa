import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { confirmarRecepcion } from './confirmar';
import { claveDerivada, productoUnico, siguienteNumero } from './simplificacion';
import { formatearQuetzales, precioACentavos } from './ventas-reglas';

export type DatosCompra = { proveedorId: number; ubicacionId: number; recibidoPorEmpleadoId: number; cantidad: number; precio: string; claveOperacion: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const entero = (n: number) => Number.isSafeInteger(n) && n > 0 && n <= 2147483647;

/**
 * Compra con ingreso físico en un solo flujo (sustituye la pantalla de Recepciones):
 *  1) compra con número automático y costo del lote; 2) recepción por la cantidad total; 3) confirmación, que es el único
 *  paso que mueve inventario y crea la capa de costo FIFO. Cada paso es idempotente por clave derivada: reintentar con
 *  la misma clave completa lo pendiente y NUNCA duplica compras, recepciones, movimientos ni capas
 *  (restricciones únicas por empresa+clave y por recepción en movimientos).
 */
export async function registrarCompraConIngreso(pool: Pool, empresaId: number, usuarioId: number, d: DatosCompra) {
  if (![empresaId, usuarioId, d.proveedorId, d.ubicacionId, d.recibidoPorEmpleadoId, d.cantidad].every(entero) || !UUID.test(d.claveOperacion)) throw Error('COMPRA_INVALIDA');
  const precio = precioACentavos(d.precio).toString();
  let compraId: number, referencia: string;
  const conn = await pool.getConnection();
  try {
    await conn.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
    await conn.beginTransaction();
    const [previas] = await conn.query<RowDataPacket[]>('SELECT id,referencia,canecas_proveedor_id,cantidad,CAST(precio_unitario_centavos AS CHAR) precio FROM canecas_compras WHERE empresa_id=? AND clave_operacion=?', [empresaId, d.claveOperacion]);
    const previa = previas[0];
    if (previa) {
      if (Number(previa.canecas_proveedor_id) !== d.proveedorId || Number(previa.cantidad) !== d.cantidad || previa.precio !== precio) throw Error('CLAVE_REUTILIZADA');
      compraId = Number(previa.id); referencia = String(previa.referencia);
    } else {
      // Proveedor, bodega y empleado deben ser de la empresa y estar activos; se bloquean contra desactivación concurrente.
      const existe = async (tabla: string, extra: string, id: number) => {
        const [f] = await conn.query<RowDataPacket[]>(`SELECT id FROM ${tabla} WHERE empresa_id=? AND id=? AND ${extra} LOCK IN SHARE MODE`, [empresaId, id]);
        return f.length === 1;
      };
      if (!(await existe('canecas_proveedores', 'activo=1', d.proveedorId)) || !(await existe('canecas_ubicaciones', 'activo=1', d.ubicacionId)) || !(await existe('empleados', "estado='Activo'", d.recibidoPorEmpleadoId))) throw Error('REFERENCIA_INVALIDA');
      const productoId = await productoUnico(conn, empresaId);
      referencia = await siguienteNumero(conn, empresaId, 'COMPRA');
      const [r] = await conn.execute<ResultSetHeader>("INSERT INTO canecas_compras (empresa_id,canecas_proveedor_id,producto_id,cantidad,referencia,clave_operacion,creado_por,precio_unitario_centavos,gastos_centavos,moneda) VALUES (?,?,?,?,?,?,?,?,0,'GTQ')", [empresaId, d.proveedorId, productoId, d.cantidad, referencia, d.claveOperacion, usuarioId, precio]);
      compraId = r.insertId;
    }
    await conn.commit();
  } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }

  const claveRecepcion = claveDerivada(d.claveOperacion, 'recepcion');
  const c2 = await pool.getConnection();
  let recepcionId: number;
  try {
    await c2.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
    await c2.beginTransaction();
    const [rec] = await c2.query<RowDataPacket[]>('SELECT id,compra_id,ubicacion_id,recibido_por_empleado_id,cantidad FROM canecas_recepciones WHERE empresa_id=? AND clave_operacion=?', [empresaId, claveRecepcion]);
    if (rec[0]) {
      if (Number(rec[0].compra_id) !== compraId || Number(rec[0].ubicacion_id) !== d.ubicacionId || Number(rec[0].recibido_por_empleado_id) !== d.recibidoPorEmpleadoId || Number(rec[0].cantidad) !== d.cantidad) throw Error('CLAVE_REUTILIZADA');
      recepcionId = Number(rec[0].id);
    } else {
      const [r] = await c2.execute<ResultSetHeader>('INSERT INTO canecas_recepciones (empresa_id,compra_id,ubicacion_id,recibido_por_empleado_id,cantidad,clave_operacion,creado_por) VALUES (?,?,?,?,?,?,?)', [empresaId, compraId, d.ubicacionId, d.recibidoPorEmpleadoId, d.cantidad, claveRecepcion, usuarioId]);
      recepcionId = r.insertId;
    }
    await c2.commit();
  } catch (error) { await c2.rollback(); throw error; } finally { c2.release(); }

  const confirmacion = await confirmarRecepcion(pool, empresaId, recepcionId, usuarioId);
  const total = formatearQuetzales(BigInt(precio) * BigInt(d.cantidad));
  return { id: compraId, referencia, recepcionId, total, yaRegistrada: confirmacion.yaConfirmada };
}
