import Decimal from "decimal.js";

/**
 * M-3A — Saldo de una factura de proveedor (lógica PURA, NO conectada a la API ni a la UI de M-3A).
 *
 * El saldo NUNCA es una columna: se DERIVA de la factura menos las aplicaciones vigentes. M-3A no lo expone porque está PENDIENTE de
 * Contabilidad sobre qué importe se trabaja la cuenta del proveedor:
 *   - TOTAL_NETO_PAGAR: total − ISR retenido (lo que se paga al proveedor); o
 *   - TOTAL_DOCUMENTO: el total de la factura, con la retención reconocida como una aplicación contable.
 * Por eso la base es un parámetro OBLIGATORIO y explícito (no hay valor por defecto) y la factura guarda ambos importes inmutables
 * (`total_documento`, `isr_monto`, `total_neto_pagar`): cualquiera de las dos opciones se puede derivar sin migrar datos.
 *
 * Estado: lo único persistido es el administrativo (REGISTRADA | ANULADA). PENDIENTE/PARCIAL/PAGADA dependen de pagos que pueden
 * anularse o reversarse, así que se derivarán («pagada = saldo en cero», regla confirmada) cuando exista el módulo de pagos.
 */
export const ESTADOS_ADMIN_CXP = ["REGISTRADA", "ANULADA"] as const;
export type EstadoAdminCxp = (typeof ESTADOS_ADMIN_CXP)[number];
export const ESTADOS_FINANCIEROS_CXP = ["PENDIENTE", "PARCIAL", "PAGADA", "ANULADA"] as const;
export type EstadoFinancieroCxp = (typeof ESTADOS_FINANCIEROS_CXP)[number];
export type BaseSaldo = "TOTAL_NETO_PAGAR" | "TOTAL_DOCUMENTO";
export type ImportesFactura = { totalDocumento: string; totalNetoPagar: string };

const importeBase = (f: ImportesFactura, base: BaseSaldo) => (base === "TOTAL_DOCUMENTO" ? f.totalDocumento : f.totalNetoPagar);

export function calcularSaldo(factura: ImportesFactura, base: BaseSaldo, aplicado = "0.00"): string {
  const saldo = new Decimal(importeBase(factura, base)).minus(aplicado);
  if (saldo.isNegative()) throw new RangeError("Las aplicaciones superan el importe de la factura.");
  return saldo.toFixed(2);
}

export function estadoFinanciero(estadoAdmin: EstadoAdminCxp, factura: ImportesFactura, base: BaseSaldo, aplicado = "0.00"): EstadoFinancieroCxp {
  if (estadoAdmin === "ANULADA") return "ANULADA";
  if (new Decimal(calcularSaldo(factura, base, aplicado)).isZero()) return "PAGADA";
  return new Decimal(aplicado).isZero() ? "PENDIENTE" : "PARCIAL";
}
