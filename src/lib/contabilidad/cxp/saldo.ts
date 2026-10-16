import Decimal from "decimal.js";

/**
 * M-3A — Saldo y estado de una factura de proveedor (lógica PURA).
 *
 * El saldo NO es una columna: se DERIVA de la factura menos las aplicaciones de pago válidas. En M-3A todavía no existe el módulo de
 * pagos, por lo que `aplicado` siempre es 0 y todo documento registrado queda PENDIENTE. Cuando existan pagos, la única entrada nueva
 * será la suma de aplicaciones vigentes (no anuladas); esta función y el estado derivado no cambian de forma.
 *
 * Estados:
 *  - ADMINISTRATIVO (persistido): REGISTRADA | ANULADA. Es lo único que se guarda, porque PENDIENTE/PARCIAL/PAGADA dependen de pagos
 *    que pueden anularse o reversarse; guardarlos obligaría a mantenerlos sincronizados a mano.
 *  - FINANCIERO (derivado): ANULADA si el documento está anulado; PAGADA si el saldo es 0; PARCIAL si hay algo aplicado y queda saldo;
 *    PENDIENTE si no se ha aplicado nada. «Pagada = saldo en cero» (regla confirmada por Contabilidad).
 *
 * BASE DEL SALDO — PENDIENTE de confirmar con Contabilidad: aquí es `total_neto_pagar` (total − ISR retenido). Si Milenium descuenta
 * el saldo del proveedor por el total y reconoce la retención como una aplicación, la base sería el total del documento.
 */
export const ESTADOS_ADMIN_CXP = ["REGISTRADA", "ANULADA"] as const;
export type EstadoAdminCxp = (typeof ESTADOS_ADMIN_CXP)[number];
export const ESTADOS_FINANCIEROS_CXP = ["PENDIENTE", "PARCIAL", "PAGADA", "ANULADA"] as const;
export type EstadoFinancieroCxp = (typeof ESTADOS_FINANCIEROS_CXP)[number];

export function calcularSaldo(totalNetoPagar: string, aplicado = "0.00"): string {
  const saldo = new Decimal(totalNetoPagar).minus(aplicado);
  if (saldo.isNegative()) throw new RangeError("Las aplicaciones superan el total de la factura.");
  return saldo.toFixed(2);
}

export function estadoFinanciero(estadoAdmin: EstadoAdminCxp, totalNetoPagar: string, aplicado = "0.00"): EstadoFinancieroCxp {
  if (estadoAdmin === "ANULADA") return "ANULADA";
  const saldo = new Decimal(calcularSaldo(totalNetoPagar, aplicado));
  if (saldo.isZero()) return "PAGADA";
  return new Decimal(aplicado).isZero() ? "PENDIENTE" : "PARCIAL";
}
