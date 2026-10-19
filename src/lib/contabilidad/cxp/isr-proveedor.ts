import Decimal from "decimal.js";

/**
 * M-3B1 — Retención de ISR a proveedores al REGISTRAR una factura normal (lógica PURA, sin BD).
 *
 * REGLAS CONFIRMADAS por Contabilidad (factura NORMAL de proveedor sujeto a ISR):
 *  1. El rango se determina SOLO con el valor neto SIN IVA (`baseNeto`); el IVA nunca forma parte de la base del ISR.
 *  2. neto <  Q2,800.00                  → Q0.00
 *     Q2,800.00 <= neto < Q30,000.00     → 5 % del valor neto
 *     neto >= Q30,000.00                 → Q1,500.00 + 7 % × (neto − Q30,000.00)
 *     (continua en Q30,000.00: 5 % × 30,000 = 1,500 = 1,500 + 7 % × 0).
 *  3. REDONDEO (confirmado): el ISR siempre se expresa con 2 decimales y la fracción se APROXIMA (mitad hacia arriba, `ROUND_HALF_UP`;
 *     nunca se trunca). Q140.005 → Q140.01; Q1,499.9995 → Q1,500.00. Se redondea UNA sola vez, sobre el ISR total exacto del tramo
 *     (fijo + variable), no sobre cada parte; los importes son siempre positivos, así que "mitad hacia arriba" = "mitad alejándose de cero".
 *  4. Pequeño contribuyente (ya confirmado en M-3A) y proveedor marcado «no sujeto a ISR» (configuración explícita) → sin retención.
 *  5. Sin retención de IVA en una factura normal.
 *
 * FUERA DE ALCANCE (no se calcula ni se aproxima): factura especial y retención de IVA se rechazan antes de llegar aquí.
 * Cada factura guarda con qué regla se calculó (`regla_isr`); las registradas con M3A_V2 conservan su cálculo (no se reescriben).
 * Las facturas M3B1_V1 que se hubieran registrado antes del redondeo confirmado solo pudieron ser montos exactos en centavos, que no cambian.
 */
export const REGLA_ISR_VERSION = "M3B1_V1";
/** Versión anterior (M-3A): se conserva solo como referencia de lectura para facturas ya registradas. */
export const REGLA_ISR_VERSION_M3A = "M3A_V2";
export const ISR_BASE_MINIMA = "2800.00";
export const ISR_TRAMO_FIJO_DESDE = "30000.00";
export const ISR_TRAMO_5_PORCENTAJE = "5.00";
export const ISR_TRAMO_FIJO_MONTO = "1500.00";
export const ISR_TRAMO_EXCEDENTE_PORCENTAJE = "7.00";

export const REGIMENES_FISCALES = ["GENERAL", "PEQUENO_CONTRIBUYENTE"] as const;
export type RegimenFiscal = (typeof REGIMENES_FISCALES)[number];

export type ReglaIsrAplicada =
  | `${typeof REGLA_ISR_VERSION}:PEQUENO_CONTRIBUYENTE_SIN_RETENCION`
  | `${typeof REGLA_ISR_VERSION}:NO_SUJETO_ISR`
  | `${typeof REGLA_ISR_VERSION}:BAJO_MINIMO_SIN_RETENCION`
  | `${typeof REGLA_ISR_VERSION}:TRAMO_5_PCT`
  | `${typeof REGLA_ISR_VERSION}:TRAMO_FIJO_1500_MAS_7_PCT_EXCEDENTE`;

export type TramoIsr = "SIN_RETENCION" | "CINCO_POR_CIENTO" | "FIJO_MAS_SIETE_POR_CIENTO";
export type EntradaIsr = { baseNeto: string; regimenFiscal: RegimenFiscal; sujetoIsr: boolean };
export type ResultadoIsr = {
  /** Tasa MARGINAL del tramo: 0.00, 5.00 o 7.00 (en el tramo alto es la tasa sobre el excedente, no una tasa efectiva). */
  porcentaje: string;
  monto: string;
  regla: ReglaIsrAplicada;
  tramo: TramoIsr;
  /** Parte fija (Q1,500.00 en el tramo alto; Q0.00 en los demás). */
  fijo: string;
  /** Parte variable = monto − fijo. */
  variable: string;
};

/** Cálculo exacto (sin redondear) del ISR de un tramo para un neto sujeto: el que Contabilidad confirmó. */
export function isrExacto(baseNeto: Decimal.Value): { tramo: TramoIsr; porcentaje: string; fijo: Decimal; exacto: Decimal } {
  const base = new Decimal(baseNeto);
  if (base.lt(ISR_BASE_MINIMA)) return { tramo: "SIN_RETENCION", porcentaje: "0.00", fijo: new Decimal(0), exacto: new Decimal(0) };
  if (base.lt(ISR_TRAMO_FIJO_DESDE)) {
    return { tramo: "CINCO_POR_CIENTO", porcentaje: ISR_TRAMO_5_PORCENTAJE, fijo: new Decimal(0), exacto: base.times(ISR_TRAMO_5_PORCENTAJE).div(100) };
  }
  const fijo = new Decimal(ISR_TRAMO_FIJO_MONTO);
  return {
    tramo: "FIJO_MAS_SIETE_POR_CIENTO", porcentaje: ISR_TRAMO_EXCEDENTE_PORCENTAJE, fijo,
    exacto: fijo.plus(base.minus(ISR_TRAMO_FIJO_DESDE).times(ISR_TRAMO_EXCEDENTE_PORCENTAJE).div(100)),
  };
}

const REGLA_POR_TRAMO: Record<TramoIsr, ReglaIsrAplicada> = {
  SIN_RETENCION: `${REGLA_ISR_VERSION}:BAJO_MINIMO_SIN_RETENCION`,
  CINCO_POR_CIENTO: `${REGLA_ISR_VERSION}:TRAMO_5_PCT`,
  FIJO_MAS_SIETE_POR_CIENTO: `${REGLA_ISR_VERSION}:TRAMO_FIJO_1500_MAS_7_PCT_EXCEDENTE`,
};

/** Redondeo confirmado por Contabilidad: 2 decimales, mitad hacia arriba (aproximación; nunca truncar). */
export const ISR_REDONDEO = Decimal.ROUND_HALF_UP;
export function redondearIsr(exacto: Decimal.Value): Decimal {
  return new Decimal(exacto).toDecimalPlaces(2, ISR_REDONDEO);
}

export function calcularIsrProveedor(entrada: EntradaIsr): ResultadoIsr {
  const base = new Decimal(entrada.baseNeto);
  if (!base.isFinite() || base.lte(0)) throw new RangeError("La base neta debe ser mayor que cero.");
  const sinRetencion = (regla: ReglaIsrAplicada): ResultadoIsr => ({ porcentaje: "0.00", monto: "0.00", regla, tramo: "SIN_RETENCION", fijo: "0.00", variable: "0.00" });
  if (entrada.regimenFiscal === "PEQUENO_CONTRIBUYENTE") return sinRetencion(`${REGLA_ISR_VERSION}:PEQUENO_CONTRIBUYENTE_SIN_RETENCION`);
  if (!entrada.sujetoIsr) return sinRetencion(`${REGLA_ISR_VERSION}:NO_SUJETO_ISR`);
  const t = isrExacto(base);
  const monto = redondearIsr(t.exacto);
  return {
    porcentaje: t.porcentaje, monto: monto.toFixed(2), regla: REGLA_POR_TRAMO[t.tramo], tramo: t.tramo,
    fijo: t.fijo.toFixed(2), variable: monto.minus(t.fijo).toFixed(2),
  };
}
