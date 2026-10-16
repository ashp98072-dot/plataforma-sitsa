import Decimal from "decimal.js";

/**
 * M-3A — Retención de ISR a proveedores al REGISTRAR una factura normal (lógica PURA, sin BD).
 *
 * REGLAS CONFIRMADAS por Contabilidad (y nada más):
 *  - Para proveedores la retención aplicable es ISR; la empresa NO retiene IVA en una factura normal de proveedor.
 *  - Pequeño contribuyente: no se retiene.
 *  - Proveedor sujeto a ISR: de Q2,800.00 a Q29,999.00 se retiene 5 % sobre el VALOR NETO (base sin IVA) de la factura.
 *
 * NO CONFIRMADO → NO se codifica (se rechaza con `ReglaIsrPendiente` en vez de inventar un número):
 *  - desde Q30,000.00 «aplica 7 %», pero la fórmula exacta está pendiente (Milenium documenta rangos con cuota fija + %);
 *  - el hueco entre Q29,999.00 y Q30,000.00 (p. ej. Q29,999.50): el enunciado no dice cuál tramo le corresponde;
 *  - factura especial (IVA e ISR «sobre la base del pago»): se calcula al pagar, fase posterior;
 *  - qué pasa con una base inferior a Q2,800.00: se interpreta como «sin retención» (no sujeto al tramo); por confirmar.
 */
export const REGLA_ISR_VERSION = "M3A_V1";
export const ISR_BASE_MINIMA = "2800.00";
export const ISR_TRAMO_5_MAXIMO = "29999.00";
export const ISR_TRAMO_5_PORCENTAJE = "5.00";

export const REGIMENES_FISCALES = ["GENERAL", "PEQUENO_CONTRIBUYENTE"] as const;
export type RegimenFiscal = (typeof REGIMENES_FISCALES)[number];

export type ReglaIsrAplicada =
  | `${typeof REGLA_ISR_VERSION}:PEQUENO_CONTRIBUYENTE_SIN_RETENCION`
  | `${typeof REGLA_ISR_VERSION}:NO_SUJETO_ISR`
  | `${typeof REGLA_ISR_VERSION}:BAJO_MINIMO_SIN_RETENCION`
  | `${typeof REGLA_ISR_VERSION}:TRAMO_5_PCT`;

/** La regla aplicable existe en el negocio pero Contabilidad aún no confirmó su fórmula: la operación se rechaza, no se aproxima. */
export class ReglaIsrPendiente extends Error {
  readonly codigo = "REGLA_ISR_PENDIENTE";
  readonly status = 422;
}

export type EntradaIsr = { baseNeto: string; regimenFiscal: RegimenFiscal; sujetoIsr: boolean };
export type ResultadoIsr = { porcentaje: string; monto: string; regla: ReglaIsrAplicada };

const redondear2 = (d: Decimal) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

export function calcularIsrProveedor(entrada: EntradaIsr): ResultadoIsr {
  const base = new Decimal(entrada.baseNeto);
  if (!base.isFinite() || base.lte(0)) throw new RangeError("La base neta debe ser mayor que cero.");
  if (entrada.regimenFiscal === "PEQUENO_CONTRIBUYENTE") {
    return { porcentaje: "0.00", monto: "0.00", regla: `${REGLA_ISR_VERSION}:PEQUENO_CONTRIBUYENTE_SIN_RETENCION` };
  }
  if (!entrada.sujetoIsr) return { porcentaje: "0.00", monto: "0.00", regla: `${REGLA_ISR_VERSION}:NO_SUJETO_ISR` };
  if (base.lt(ISR_BASE_MINIMA)) return { porcentaje: "0.00", monto: "0.00", regla: `${REGLA_ISR_VERSION}:BAJO_MINIMO_SIN_RETENCION` };
  if (base.lte(ISR_TRAMO_5_MAXIMO)) {
    return { porcentaje: ISR_TRAMO_5_PORCENTAJE, monto: redondear2(base.times(ISR_TRAMO_5_PORCENTAJE).div(100)).toFixed(2), regla: `${REGLA_ISR_VERSION}:TRAMO_5_PCT` };
  }
  throw new ReglaIsrPendiente(
    "La retención de ISR para una base mayor a Q29,999.00 está pendiente de confirmación de Contabilidad (desde Q30,000.00 aplica 7 % con fórmula aún no definida). La factura no se registra hasta definirla.",
  );
}
