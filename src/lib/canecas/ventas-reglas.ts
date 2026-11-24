/** Importes en centavos enteros (bigint). Sin acceso a base de datos. Moneda: siempre GTQ. */
const MAX_PRECIO_CENTAVOS = BigInt(100000000); // Q1,000,000.00 por caneca
const MAX_CANTIDAD = 1000000;

/** "12.5" -> 1250n. Solo quetzales con hasta dos decimales; no admite cero ni negativos. */
export function precioACentavos(valor: string): bigint {
  const texto = String(valor ?? '').trim();
  if (!/^\d{1,9}(?:\.\d{1,2})?$/.test(texto)) throw new Error('VENTA_INVALIDA');
  const [entero, decimal = ''] = texto.split('.');
  const centavos = BigInt(entero) * BigInt(100) + BigInt(decimal.padEnd(2, '0'));
  if (centavos <= BigInt(0) || centavos > MAX_PRECIO_CENTAVOS) throw new Error('VENTA_INVALIDA');
  return centavos;
}

export function validarCantidadVenta(cantidad: number): number {
  if (!Number.isSafeInteger(cantidad) || cantidad < 1 || cantidad > MAX_CANTIDAD) throw new Error('VENTA_INVALIDA');
  return cantidad;
}

/** Fecha de venta en formato AAAA-MM-DD, real y no posterior a `hoy` (AAAA-MM-DD). */
export function validarFechaVenta(fecha: string, hoy: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new Error('VENTA_INVALIDA');
  const d = new Date(`${fecha}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== fecha || fecha > hoy || fecha < '2000-01-01') throw new Error('VENTA_INVALIDA');
  return fecha;
}

export type ResultadoVenta = { totalCentavos: bigint; costoCentavos: bigint; utilidadCentavos: bigint };
/** Ingreso = precio × cantidad; utilidad bruta = ingreso − costo FIFO real de las unidades vendidas. */
export function calcularVenta(precioCentavos: bigint, cantidad: number, costoFifoCentavos: bigint): ResultadoVenta {
  const totalCentavos = precioCentavos * BigInt(cantidad);
  return { totalCentavos, costoCentavos: costoFifoCentavos, utilidadCentavos: totalCentavos - costoFifoCentavos };
}

/** 123456 -> "Q 1,234.56" (negativos: "-Q 12.30"). */
export function formatearQuetzales(centavos: bigint | string | number): string {
  const v = BigInt(centavos);
  const negativo = v < BigInt(0);
  const abs = negativo ? -v : v;
  const entero = (abs / BigInt(100)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const decimales = (abs % BigInt(100)).toString().padStart(2, '0');
  return `${negativo ? '-' : ''}Q ${entero}.${decimales}`;
}
