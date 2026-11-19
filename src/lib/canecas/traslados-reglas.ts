/** Reglas aritméticas del traslado. Deben ejecutarse dentro de la transacción
 * que bloquea el traslado y sus partidas; no sustituyen dichos bloqueos. */
export type SaldoTraslado = { enviado: number; recibido: number; faltante: number };

function enteroNoNegativo(n: number): boolean {
  return Number.isSafeInteger(n) && n >= 0 && n <= 2147483647;
}

export function calcularTransito(saldo: SaldoTraslado): number {
  if (![saldo.enviado, saldo.recibido, saldo.faltante].every(enteroNoNegativo)) throw new Error("CANTIDAD_INVALIDA");
  const pendiente = saldo.enviado - saldo.recibido - saldo.faltante;
  if (pendiente < 0) throw new Error("CANTIDAD_EXCEDE_ENVIO");
  return pendiente;
}

export function registrarRecepcion(saldo: SaldoTraslado, cantidad: number, faltante: number): SaldoTraslado {
  if (!enteroNoNegativo(cantidad) || !enteroNoNegativo(faltante) || cantidad + faltante === 0) throw new Error("CANTIDAD_INVALIDA");
  if (cantidad + faltante > calcularTransito(saldo)) throw new Error("CANTIDAD_EXCEDE_ENVIO");
  return { ...saldo, recibido: saldo.recibido + cantidad, faltante: saldo.faltante + faltante };
}

export function estadoTraslado(partidas: SaldoTraslado[]): "ENVIADO" | "RECIBIDO" | "CON_DIFERENCIAS" {
  if (!partidas.length) throw new Error("SIN_PARTIDAS");
  const pendientes = partidas.map(calcularTransito);
  if (pendientes.some(n => n > 0)) return "ENVIADO";
  return partidas.some(p => p.faltante > 0) ? "CON_DIFERENCIAS" : "RECIBIDO";
}

