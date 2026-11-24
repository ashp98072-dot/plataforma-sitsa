/** Importes en centavos enteros (bigint). Sin acceso a base de datos. */
export type CapaOrigen = { capaId: string; cantidad: number; creadoEn: string; costoUnitarioCentavos: bigint };
export type SegmentoResultante = { cantidad: number; creadoEn: string; costoUnitarioCentavos: bigint };

/**
 * Reparte el costo total de las capas de origen entre `cantidadResultante` unidades.
 *
 * - El costo total se conserva exactamente: base = total / N y el resto en centavos se
 *   asigna de a 1 centavo a las primeras (más antiguas) unidades.
 * - Las unidades se emparejan por posición con las unidades de origen, en orden FIFO,
 *   para conservar la antigüedad del lote: si hay más unidades que en el origen, las
 *   extras toman la antigüedad de la última unidad de origen; si hay menos (merma), se
 *   conservan las más antiguas.
 * - Las capas de origen deben venir ordenadas por antigüedad (creado_en, id).
 */
export function repartirRedistribucion(origenes: CapaOrigen[], cantidadResultante: number): { costoTotalCentavos: bigint; cantidadOrigen: number; segmentos: SegmentoResultante[] } {
  if (!origenes.length || !Number.isSafeInteger(cantidadResultante) || cantidadResultante <= 0) throw new Error('REDISTRIBUCION_INVALIDA');
  let cantidadOrigen = 0;
  let costoTotal = BigInt(0);
  for (const o of origenes) {
    if (!Number.isSafeInteger(o.cantidad) || o.cantidad <= 0 || o.costoUnitarioCentavos < BigInt(0)) throw new Error('REDISTRIBUCION_INVALIDA');
    cantidadOrigen += o.cantidad;
    costoTotal += o.costoUnitarioCentavos * BigInt(o.cantidad);
  }
  const n = BigInt(cantidadResultante);
  const base = costoTotal / n;
  const conCentavoExtra = Number(costoTotal % n);
  const antiguedades: string[] = [];
  for (const o of origenes) for (let i = 0; i < o.cantidad && antiguedades.length < cantidadResultante; i++) antiguedades.push(o.creadoEn);
  while (antiguedades.length < cantidadResultante) antiguedades.push(origenes[origenes.length - 1].creadoEn);
  const segmentos: SegmentoResultante[] = [];
  for (let i = 0; i < cantidadResultante; i++) {
    const costo = i < conCentavoExtra ? base + BigInt(1) : base;
    const ultimo = segmentos[segmentos.length - 1];
    if (ultimo && ultimo.creadoEn === antiguedades[i] && ultimo.costoUnitarioCentavos === costo) ultimo.cantidad += 1;
    else segmentos.push({ cantidad: 1, creadoEn: antiguedades[i], costoUnitarioCentavos: costo });
  }
  const verificado = segmentos.reduce((s, x) => s + x.costoUnitarioCentavos * BigInt(x.cantidad), BigInt(0));
  if (verificado !== costoTotal || segmentos.reduce((s, x) => s + x.cantidad, 0) !== cantidadResultante) throw new Error('CONCILIACION_INVALIDA');
  return { costoTotalCentavos: costoTotal, cantidadOrigen, segmentos };
}
