/** Importes en centavos enteros. El costo desconocido se representa con null. */
export type CapaRecepcion = { cantidad: number; costoUnitarioCentavos: bigint | null };

/**
 * Distribuye el gasto de compra sobre las unidades, conservando exactamente los
 * centavos. El bloqueo de la compra debe serializar las recepciones y el
 * desplazamiento debe ser la cantidad ya confirmada antes de esta recepción.
 */
export function capasParaRecepcion(input: {
  cantidadComprada: number;
  cantidadPrevia: number;
  cantidadRecibida: number;
  precioUnitarioCentavos: bigint | null;
  gastosCentavos: bigint | null;
}): CapaRecepcion[] {
  const { cantidadComprada, cantidadPrevia, cantidadRecibida, precioUnitarioCentavos, gastosCentavos } = input;
  if (![cantidadComprada, cantidadPrevia, cantidadRecibida].every(Number.isSafeInteger) ||
      cantidadComprada <= 0 || cantidadPrevia < 0 || cantidadRecibida <= 0 ||
      cantidadPrevia + cantidadRecibida > cantidadComprada ||
      (precioUnitarioCentavos !== null && precioUnitarioCentavos < 0n) ||
      (gastosCentavos !== null && gastosCentavos < 0n)) throw new Error('COSTO_O_CANTIDAD_INVALIDOS');
  if (precioUnitarioCentavos === null || gastosCentavos === null) return [{ cantidad: cantidadRecibida, costoUnitarioCentavos: null }];
  const unidades = BigInt(cantidadComprada);
  const base = precioUnitarioCentavos + gastosCentavos / unidades;
  const conCentavoExtra = Number(gastosCentavos % unidades);
  const cantidadExtra = Math.max(0, Math.min(cantidadPrevia + cantidadRecibida, conCentavoExtra) - cantidadPrevia);
  const capas: CapaRecepcion[] = [];
  if (cantidadExtra) capas.push({ cantidad: cantidadExtra, costoUnitarioCentavos: base + 1n });
  if (cantidadRecibida > cantidadExtra) capas.push({ cantidad: cantidadRecibida - cantidadExtra, costoUnitarioCentavos: base });
  return capas;
}
