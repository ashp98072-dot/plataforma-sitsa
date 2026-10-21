import Decimal from "decimal.js";

/**
 * M-3B1 — Saldo de una factura de proveedor (lógica PURA). El saldo NUNCA es una columna: se DERIVA de la factura y de los pagos aplicados VIGENTES.
 *
 * Regla confirmada por Contabilidad: la retención de ISR se RESTA del total de la factura para obtener lo efectivamente pagadero al proveedor.
 *   total factura (`total_documento`)  = base neta + IVA
 *   retención ISR (`isr_monto`)        = lo que la empresa retiene y NO paga al proveedor (no es un pago bancario ni una aplicación)
 *   monto pagadero (`total_neto_pagar`) = total − retención
 *   pagado                              = suma de aplicaciones de pagos REGISTRADOS (los reversados no cuentan)
 *   saldo                               = monto pagadero − pagado       (nunca negativo; no hay sobreaplicación)
 * «Pagada» = saldo en cero (regla confirmada). Estado persistido: solo el administrativo (REGISTRADA | ANULADA).
 */
export const ESTADOS_ADMIN_CXP = ["REGISTRADA", "ANULADA"] as const;
export type EstadoAdminCxp = (typeof ESTADOS_ADMIN_CXP)[number];
export const ESTADOS_FINANCIEROS_CXP = ["PENDIENTE", "PARCIAL", "PAGADA", "ANULADA"] as const;
export type EstadoFinancieroCxp = (typeof ESTADOS_FINANCIEROS_CXP)[number];
export type ImportesFactura = { totalDocumento: string; isrMonto: string; totalNetoPagar: string };
export type DesgloseFinanciero = {
  totalDocumento: string; retencionIsr: string; montoPagadero: string; pagado: string; saldo: string; estadoFinanciero: EstadoFinancieroCxp;
};

/** Saldo pendiente = monto pagadero − pagado. Aplicar de más es un error (RangeError): la sobreaplicación no es representable. */
export function calcularSaldo(factura: Pick<ImportesFactura, "totalNetoPagar">, aplicado = "0.00"): string {
  const saldo = new Decimal(factura.totalNetoPagar).minus(aplicado);
  if (saldo.isNegative()) throw new RangeError("Las aplicaciones superan el monto pagadero de la factura.");
  return saldo.toFixed(2);
}

export function estadoFinanciero(estadoAdmin: EstadoAdminCxp, factura: Pick<ImportesFactura, "totalNetoPagar">, aplicado = "0.00"): EstadoFinancieroCxp {
  if (estadoAdmin === "ANULADA") return "ANULADA";
  if (new Decimal(calcularSaldo(factura, aplicado)).isZero()) return "PAGADA";
  return new Decimal(aplicado).isZero() ? "PENDIENTE" : "PARCIAL";
}

/** Los cinco importes que la UI debe distinguir, más el estado financiero derivado. La retención NO se cuenta como pagado. */
export function desgloseFinanciero(estadoAdmin: EstadoAdminCxp, factura: ImportesFactura, aplicado = "0.00"): DesgloseFinanciero {
  return {
    totalDocumento: new Decimal(factura.totalDocumento).toFixed(2), retencionIsr: new Decimal(factura.isrMonto).toFixed(2),
    montoPagadero: new Decimal(factura.totalNetoPagar).toFixed(2), pagado: new Decimal(aplicado).toFixed(2),
    // Una factura anulada no adeuda nada (no tiene pagos aplicados: la anulación los exige reversados).
    saldo: estadoAdmin === "ANULADA" ? "0.00" : calcularSaldo(factura, aplicado), estadoFinanciero: estadoFinanciero(estadoAdmin, factura, aplicado),
  };
}
