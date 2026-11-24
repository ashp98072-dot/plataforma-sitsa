/** Importes en centavos enteros (bigint). Sin acceso a base de datos. */
/** `orden` es la prioridad FIFO efectiva de la capa de origen: COALESCE(orden_fifo, id). */
export type CapaOrigen = { capaId: string; cantidad: number; creadoEn: string; orden: bigint; costoUnitarioCentavos: bigint };
export type SegmentoResultante = { cantidad: number; creadoEn: string; ordenFifo: bigint; costoUnitarioCentavos: bigint };

/**
 * Reparte el costo total de las capas de origen entre `cantidadResultante` unidades.
 *
 * - El costo total se conserva exactamente: base = total / N y el resto en centavos se
 *   asigna de a 1 centavo a las primeras (más antiguas) unidades.
 * - Las unidades se emparejan por posición con las unidades de origen, en orden FIFO,
 *   para conservar la antigüedad Y la prioridad FIFO del lote (creado_en + orden): si hay
 *   más unidades que en el origen, las extras toman los de la última unidad de origen; si
 *   hay menos (merma), se conservan las más antiguas. La prioridad heredada evita que un
 *   empate de segundo con otra compra invierta el orden al recibir ids nuevos.
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
  const posiciones: { creadoEn: string; orden: bigint }[] = [];
  for (const o of origenes) for (let i = 0; i < o.cantidad && posiciones.length < cantidadResultante; i++) posiciones.push({ creadoEn: o.creadoEn, orden: o.orden });
  const ultima = origenes[origenes.length - 1];
  while (posiciones.length < cantidadResultante) posiciones.push({ creadoEn: ultima.creadoEn, orden: ultima.orden });
  const segmentos: SegmentoResultante[] = [];
  for (let i = 0; i < cantidadResultante; i++) {
    const costo = i < conCentavoExtra ? base + BigInt(1) : base;
    const ultimo = segmentos[segmentos.length - 1];
    const { creadoEn, orden } = posiciones[i];
    if (ultimo && ultimo.creadoEn === creadoEn && ultimo.ordenFifo === orden && ultimo.costoUnitarioCentavos === costo) ultimo.cantidad += 1;
    else segmentos.push({ cantidad: 1, creadoEn, ordenFifo: orden, costoUnitarioCentavos: costo });
  }
  const verificado = segmentos.reduce((s, x) => s + x.costoUnitarioCentavos * BigInt(x.cantidad), BigInt(0));
  if (verificado !== costoTotal || segmentos.reduce((s, x) => s + x.cantidad, 0) !== cantidadResultante) throw new Error('CONCILIACION_INVALIDA');
  return { costoTotalCentavos: costoTotal, cantidadOrigen, segmentos };
}
