import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { confirmarRecepcionEnTransaccion } from './confirmar';
import { asegurarSecuencias, claveDerivada, productoUnico, siguienteNumero } from './simplificacion';
import { formatearQuetzales, precioACentavos } from './ventas-reglas';

export type DatosCompra = { proveedorId: number; ubicacionId: number; recibidoPorEmpleadoId: number; cantidad: number; precio: string; claveOperacion: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type ResultadoCompra = { id: number; referencia: string; recepcionId: number; total: string; yaRegistrada: boolean };
const MAX_REINTENTOS_DUPLICADO = 7;
const entero = (n: number) => Number.isSafeInteger(n) && n > 0 && n <= 2147483647;

/**
 * Compra con ingreso físico en UNA transacción (sustituye la pantalla de Recepciones): compra con número automático y
 * costo del lote, recepción por la cantidad total elegida (bodega y receptor explícitos), saldo, movimiento y capa FIFO.
 * Todo se confirma junto o nada: no existen compras ni recepciones a medias. La identidad completa de la operación
 * (proveedor, cantidad, precio, bodega y receptor) se verifica en cada reintento con la misma clave, que devuelve la
 * compra ya registrada sin duplicar compras, recepciones, movimientos ni capas.
 */
export async function registrarCompraConIngreso(pool: Pool, empresaId: number, usuarioId: number, d: DatosCompra, intento = 0): Promise<ResultadoCompra> {
  if (![empresaId, usuarioId, d.proveedorId, d.ubicacionId, d.recibidoPorEmpleadoId, d.cantidad].every(entero) || !UUID.test(d.claveOperacion)) throw Error('COMPRA_INVALIDA');
  const precio = precioACentavos(d.precio).toString();
  const total = formatearQuetzales(BigInt(precio) * BigInt(d.cantidad));
  const claveRecepcion = claveDerivada(d.claveOperacion, 'recepcion');
  await asegurarSecuencias(pool, empresaId);
  const conn = await pool.getConnection();
  try {
    await conn.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
    await conn.beginTransaction();
    const [previas] = await conn.query<RowDataPacket[]>('SELECT id,referencia,canecas_proveedor_id,cantidad,CAST(precio_unitario_centavos AS CHAR) precio FROM canecas_compras WHERE empresa_id=? AND clave_operacion=?', [empresaId, d.claveOperacion]);
    const previa = previas[0];
    if (previa) {
      // Una compra con esta clave solo es la misma operación si coincide TODO, incluida su recepción (bodega y receptor).
      const [recs] = await conn.query<RowDataPacket[]>('SELECT id,compra_id,ubicacion_id,recibido_por_empleado_id,cantidad,estado FROM canecas_recepciones WHERE empresa_id=? AND clave_operacion=?', [empresaId, claveRecepcion]);
      const rec = recs[0];
      if (Number(previa.canecas_proveedor_id) !== d.proveedorId || Number(previa.cantidad) !== d.cantidad || previa.precio !== precio || !rec || Number(rec.compra_id) !== Number(previa.id) || Number(rec.ubicacion_id) !== d.ubicacionId || Number(rec.recibido_por_empleado_id) !== d.recibidoPorEmpleadoId || Number(rec.cantidad) !== d.cantidad || rec.estado !== 'CONFIRMADA') throw Error('CLAVE_REUTILIZADA');
      await conn.commit();
      return { id: Number(previa.id), referencia: String(previa.referencia), recepcionId: Number(rec.id), total, yaRegistrada: true };
    }
    // Proveedor, bodega y empleado deben ser de la empresa y estar activos; se bloquean contra desactivación concurrente.
    const existe = async (tabla: string, extra: string, id: number) => {
      const [f] = await conn.query<RowDataPacket[]>(`SELECT id FROM ${tabla} WHERE empresa_id=? AND id=? AND ${extra} LOCK IN SHARE MODE`, [empresaId, id]);
      return f.length === 1;
    };
    if (!(await existe('canecas_proveedores', 'activo=1', d.proveedorId)) || !(await existe('canecas_ubicaciones', 'activo=1', d.ubicacionId)) || !(await existe('empleados', "estado='Activo'", d.recibidoPorEmpleadoId))) throw Error('REFERENCIA_INVALIDA');
    const productoId = await productoUnico(conn, empresaId);
    const referencia = await siguienteNumero(conn, empresaId, 'COMPRA');
    const [c] = await conn.execute<ResultSetHeader>("INSERT INTO canecas_compras (empresa_id,canecas_proveedor_id,producto_id,cantidad,referencia,clave_operacion,creado_por,precio_unitario_centavos,gastos_centavos,moneda) VALUES (?,?,?,?,?,?,?,?,0,'GTQ')", [empresaId, d.proveedorId, productoId, d.cantidad, referencia, d.claveOperacion, usuarioId, precio]);
    const [r] = await conn.execute<ResultSetHeader>('INSERT INTO canecas_recepciones (empresa_id,compra_id,ubicacion_id,recibido_por_empleado_id,cantidad,clave_operacion,creado_por) VALUES (?,?,?,?,?,?,?)', [empresaId, c.insertId, d.ubicacionId, d.recibidoPorEmpleadoId, d.cantidad, claveRecepcion, usuarioId]);
    await confirmarRecepcionEnTransaccion(conn, empresaId, r.insertId, usuarioId);
    await conn.commit();
    return { id: c.insertId, referencia, recepcionId: r.insertId, total, yaRegistrada: false };
  } catch (error) {
    await conn.rollback();
    // Carrera resuelta por la base: (a) otra solicitud con la MISMA clave confirmó primero (uq_can_compra_clave) -> el reintento la encuentra
    // y la devuelve; (b) un documento escrito a mano con el MISMO número generado (uq_can_compra_ref_auto, API histórica) ganó -> el reintento
    // toma el siguiente número. Acotado: no se reintenta indefinidamente.
    if ((error as { code?: string }).code === 'ER_DUP_ENTRY' && intento < MAX_REINTENTOS_DUPLICADO && /uq_can_compra_(clave|ref_auto)/.test(String((error as Error).message))) {
      return registrarCompraConIngreso(pool, empresaId, usuarioId, d, intento + 1);
    }
    throw error;
  } finally { conn.release(); }
}
