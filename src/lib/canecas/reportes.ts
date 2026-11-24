import type { Pool, RowDataPacket } from 'mysql2/promise';
import { formatearQuetzales } from './ventas-reglas';

/** Filtros de los reportes comerciales. Las fechas son AAAA-MM-DD e inclusivas. */
export type FiltrosReporte = { desde?: string; hasta?: string; productoId?: number; clienteId?: number };
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const entero = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n > 0 && n <= 2147483647;

export function validarFiltros(f: FiltrosReporte): FiltrosReporte {
  for (const fecha of [f.desde, f.hasta]) if (fecha !== undefined && (!FECHA.test(fecha) || Number.isNaN(new Date(`${fecha}T00:00:00Z`).getTime()) || new Date(`${fecha}T00:00:00Z`).toISOString().slice(0, 10) !== fecha)) throw Error('FILTRO_INVALIDO');
  if (f.desde && f.hasta && f.desde > f.hasta) throw Error('FILTRO_INVALIDO');
  for (const id of [f.productoId, f.clienteId]) if (id !== undefined && !entero(id)) throw Error('FILTRO_INVALIDO');
  return f;
}

/** Arma "AND ..." con parámetros para una columna de fecha (o DATE(columna)) y los ids opcionales. */
function condiciones(f: FiltrosReporte, opts: { fecha?: string; producto?: string; cliente?: string }) {
  const sql: string[] = [], params: (string | number)[] = [];
  if (opts.fecha && f.desde) { sql.push(`AND ${opts.fecha} >= ?`); params.push(f.desde); }
  if (opts.fecha && f.hasta) { sql.push(`AND ${opts.fecha} <= ?`); params.push(f.hasta); }
  if (opts.producto && f.productoId) { sql.push(`AND ${opts.producto} = ?`); params.push(f.productoId); }
  if (opts.cliente && f.clienteId) { sql.push(`AND ${opts.cliente} = ?`); params.push(f.clienteId); }
  return { sql: sql.join(' '), params };
}

type Fila = RowDataPacket;
type Metricas = { productoId: number; compradas: number; recibidas: number; extras: number; merma: number; vendidas: number; ingresos: bigint; costoVentas: bigint; existencias: number; conCostoPendiente: number; comprasValor: bigint; comprasSinCosto: number };
const vacio = (productoId: number): Metricas => ({ productoId, compradas: 0, recibidas: 0, extras: 0, merma: 0, vendidas: 0, ingresos: BigInt(0), costoVentas: BigInt(0), existencias: 0, conCostoPendiente: 0, comprasValor: BigInt(0), comprasSinCosto: 0 });

async function metricasPorProducto(pool: Pool, empresaId: number, f: FiltrosReporte) {
  const mapa = new Map<number, Metricas>();
  const m = (id: number) => { if (!mapa.has(id)) mapa.set(id, vacio(id)); return mapa.get(id)!; };
  const soloVentas = f.clienteId !== undefined; // los demás indicadores no dependen del cliente
  const q = async (sql: string, params: unknown[]) => (await pool.query<Fila[]>(sql, params as never))[0];
  const v = condiciones(f, { fecha: 'fecha_venta', producto: 'producto_id', cliente: 'cliente_id' });
  for (const r of await q(`SELECT producto_id,CAST(SUM(cantidad) AS CHAR) n,CAST(SUM(total_centavos) AS CHAR) ingresos,CAST(SUM(costo_centavos) AS CHAR) costo FROM canecas_ventas WHERE empresa_id=? AND estado='ACTIVA' ${v.sql} GROUP BY producto_id`, [empresaId, ...v.params])) {
    const x = m(Number(r.producto_id)); x.vendidas = Number(r.n); x.ingresos = BigInt(r.ingresos); x.costoVentas = BigInt(r.costo);
  }
  if (!soloVentas) {
    const c = condiciones(f, { fecha: 'DATE(creado_en)', producto: 'producto_id' });
    for (const r of await q(`SELECT producto_id,CAST(SUM(cantidad) AS CHAR) n,CAST(COALESCE(SUM(CASE WHEN precio_unitario_centavos IS NOT NULL AND gastos_centavos IS NOT NULL THEN CAST(precio_unitario_centavos AS DECIMAL(38,0))*cantidad+gastos_centavos END),0) AS CHAR) valor,SUM(precio_unitario_centavos IS NULL OR gastos_centavos IS NULL) sin_costo FROM canecas_compras WHERE empresa_id=? ${c.sql} GROUP BY producto_id`, [empresaId, ...c.params])) {
      const x = m(Number(r.producto_id)); x.compradas = Number(r.n); x.comprasValor = BigInt(r.valor); x.comprasSinCosto = Number(r.sin_costo);
    }
    const rc = condiciones(f, { fecha: 'DATE(r.confirmado_en)', producto: 'c.producto_id' });
    for (const r of await q(`SELECT c.producto_id,CAST(SUM(r.cantidad) AS CHAR) n FROM canecas_recepciones r JOIN canecas_compras c ON c.empresa_id=r.empresa_id AND c.id=r.compra_id WHERE r.empresa_id=? AND r.estado='CONFIRMADA' ${rc.sql} GROUP BY c.producto_id`, [empresaId, ...rc.params])) m(Number(r.producto_id)).recibidas = Number(r.n);
    const a = condiciones(f, { fecha: 'DATE(creado_en)', producto: 'producto_id' });
    for (const r of await q(`SELECT producto_id,CAST(SUM(GREATEST(diferencia,0)) AS CHAR) extras,CAST(SUM(GREATEST(-diferencia,0)) AS CHAR) merma FROM canecas_redistribuciones WHERE empresa_id=? AND reversado_en IS NULL ${a.sql} GROUP BY producto_id`, [empresaId, ...a.params])) { const x = m(Number(r.producto_id)); x.extras = Number(r.extras); x.merma = Number(r.merma); }
    const s = condiciones(f, { producto: 'producto_id' });
    for (const r of await q(`SELECT producto_id,CAST(SUM(fisico) AS CHAR) n FROM canecas_saldos WHERE empresa_id=? ${s.sql} GROUP BY producto_id`, [empresaId, ...s.params])) m(Number(r.producto_id)).existencias = Number(r.n);
    for (const r of await q(`SELECT producto_id,CAST(SUM(cantidad_disponible) AS CHAR) n FROM canecas_capas_costo WHERE empresa_id=? AND costo_unitario_centavos IS NULL ${s.sql} GROUP BY producto_id`, [empresaId, ...s.params])) m(Number(r.producto_id)).conCostoPendiente = Number(r.n);
  }
  return { mapa, soloVentas };
}

const fila = (x: Metricas, soloVentas: boolean, conCostos: boolean) => ({
  vendidas: x.vendidas,
  ingresos: formatearQuetzales(x.ingresos),
  ...(conCostos ? { costo_ventas: formatearQuetzales(x.costoVentas), utilidad_bruta: formatearQuetzales(x.ingresos - x.costoVentas) } : {}),
  ...(soloVentas ? {} : { compradas: x.compradas, recibidas: x.recibidas, extras: x.extras, merma: x.merma, existencias: x.existencias, existencias_con_costo_pendiente: x.conCostoPendiente, ...(conCostos ? { compras_valor: formatearQuetzales(x.comprasValor), compras_sin_costo: x.comprasSinCosto } : {}) }),
});

/** Resumen del período. Utilidad bruta = ingresos netos de ventas activas − costo FIFO de esas mismas ventas (las anuladas no cuentan). */
export async function reporteResumen(pool: Pool, empresaId: number, filtros: FiltrosReporte, conCostos: boolean) {
  const f = validarFiltros(filtros);
  const { mapa, soloVentas } = await metricasPorProducto(pool, empresaId, f);
  const total = vacio(0);
  for (const x of mapa.values()) for (const k of ['compradas', 'recibidas', 'extras', 'merma', 'vendidas', 'existencias', 'conCostoPendiente', 'comprasSinCosto'] as const) total[k] += x[k];
  for (const x of mapa.values()) { total.ingresos += x.ingresos; total.costoVentas += x.costoVentas; total.comprasValor += x.comprasValor; }
  const v = condiciones(f, { fecha: 'fecha_venta', producto: 'producto_id', cliente: 'cliente_id' });
  const [anuladas] = await pool.query<Fila[]>(`SELECT COUNT(*) n,CAST(COALESCE(SUM(cantidad),0) AS CHAR) unidades,CAST(COALESCE(SUM(total_centavos),0) AS CHAR) importe FROM canecas_ventas WHERE empresa_id=? AND estado='ANULADA' ${v.sql}`, [empresaId, ...v.params]);
  return { ...fila(total, soloVentas, conCostos), ventas_anuladas: Number(anuladas[0].n), unidades_anuladas: Number(anuladas[0].unidades), importe_anulado: formatearQuetzales(BigInt(anuladas[0].importe)), solo_ventas: soloVentas, existencias_son_actuales: !soloVentas };
}

/** Un renglón por producto con los mismos indicadores. */
export async function reportePorProducto(pool: Pool, empresaId: number, filtros: FiltrosReporte, conCostos: boolean) {
  const f = validarFiltros(filtros);
  const { mapa, soloVentas } = await metricasPorProducto(pool, empresaId, f);
  const [productos] = await pool.query<Fila[]>(`SELECT id,nombre,presentacion FROM canecas_productos WHERE empresa_id=? ${f.productoId ? 'AND id=?' : ''} ORDER BY nombre,id`, f.productoId ? [empresaId, f.productoId] : [empresaId]);
  return productos.map(p => ({ producto: `${p.nombre}${p.presentacion ? ` — ${p.presentacion}` : ''}`, ...fila(mapa.get(Number(p.id)) ?? vacio(Number(p.id)), soloVentas, conCostos) }));
}

/** Historial de ventas y anulaciones (más recientes primero). Sin permiso de costos no se muestran costo ni utilidad. */
export async function historialVentas(pool: Pool, empresaId: number, filtros: FiltrosReporte, conCostos: boolean) {
  const f = validarFiltros(filtros);
  const c = condiciones(f, { fecha: 'v.fecha_venta', producto: 'v.producto_id', cliente: 'v.cliente_id' });
  const [rows] = await pool.query<Fila[]>(`SELECT CAST(v.id AS CHAR) id,DATE_FORMAT(v.fecha_venta,'%Y-%m-%d') fecha,v.documento,cl.nombre_comercial cliente,p.nombre producto,v.cantidad,
      CONCAT('Q ',FORMAT(v.precio_unitario_centavos/100,2)) precio_unitario,CONCAT('Q ',FORMAT(v.total_centavos/100,2)) total
      ${conCostos ? ",CONCAT('Q ',FORMAT(v.costo_centavos/100,2)) costo_fifo,CONCAT(IF(v.total_centavos-v.costo_centavos<0,'-Q ','Q '),FORMAT(ABS(v.total_centavos-v.costo_centavos)/100,2)) utilidad" : ''},
      v.estado,us.username usuario,v.creado_en,ua.username anulada_por,v.anulada_en,v.motivo_anulacion
    FROM canecas_ventas v JOIN canecas_clientes cl ON cl.empresa_id=v.empresa_id AND cl.id=v.cliente_id JOIN canecas_productos p ON p.empresa_id=v.empresa_id AND p.id=v.producto_id
    JOIN usuarios us ON us.id=v.creado_por LEFT JOIN usuarios ua ON ua.id=v.anulada_por WHERE v.empresa_id=? ${c.sql} ORDER BY v.fecha_venta DESC,v.id DESC LIMIT 500`, [empresaId, ...c.params]);
  return rows;
}
