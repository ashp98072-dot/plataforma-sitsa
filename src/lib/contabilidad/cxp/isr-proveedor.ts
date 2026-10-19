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
 *  3. Los centavos del resultado se conservan (no se redondea a quetzales enteros).
 *  4. Pequeño contribuyente (ya confirmado en M-3A) y proveedor marcado «no sujeto a ISR» (configuración explícita) → sin retención.
 *  5. Sin retención de IVA en una factura normal.
 *
 * LO QUE SIGUE PENDIENTE Y SE BLOQUEA (`ReglaIsrPendiente`, 422, no se escribe nada) en vez de asumirlo:
 *  - REDONDEO: el resultado tiene fracciones de centavo (p. ej. 5 % de Q2,800.10 = Q140.005; 7 % de Q0.01 de excedente). Contabilidad confirmó
 *    conservar los centavos pero NO cómo tratar una fracción MENOR a un centavo; ninguna modalidad (mitad arriba/abajo, truncar) queda codificada
 *    por defecto. `calcularIsrProveedor` acepta un modo de redondeo EXPLÍCITO como segundo argumento (para cuando se confirme), pero ningún
 *    flujo de producción lo pasa.
 *  - Factura especial y retención de IVA: fuera de este módulo (se rechazan antes de llegar aquí).
 * Cada factura guarda con qué regla se calculó (`regla_isr`); las registradas con M3A_V2 conservan su cálculo (no se reescriben).
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

export type MotivoReglaPendiente = "REDONDEO";
const MENSAJES: Record<MotivoReglaPendiente, string> = {
  REDONDEO: "Retención de ISR pendiente de confirmación de Contabilidad: el resultado tiene una fracción menor a un centavo y la regla de redondeo no está definida. La factura no se registra hasta definirla.",
};

/** La regla aplicable existe en el negocio pero Contabilidad aún no confirmó su fórmula: la operación se rechaza, no se aproxima. */
export class ReglaIsrPendiente extends Error {
  readonly codigo = "REGLA_ISR_PENDIENTE";
  readonly status = 422;
  constructor(readonly motivo: MotivoReglaPendiente, detalle?: string) {
    super(detalle ? `${MENSAJES[motivo]} (${detalle})` : MENSAJES[motivo]);
    this.name = "ReglaIsrPendiente";
  }
}

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

/**
 * @param redondeoFraccionCentavo NO usar en producción: solo existe para probar que la aritmética es correcta con un modo explícito y para que,
 * cuando Contabilidad confirme el modo, el cambio sea una sola línea en el llamador. Sin él, una fracción de centavo bloquea.
 */
export function calcularIsrProveedor(entrada: EntradaIsr, redondeoFraccionCentavo?: Decimal.Rounding): ResultadoIsr {
  const base = new Decimal(entrada.baseNeto);
  if (!base.isFinite() || base.lte(0)) throw new RangeError("La base neta debe ser mayor que cero.");
  const sinRetencion = (regla: ReglaIsrAplicada): ResultadoIsr => ({ porcentaje: "0.00", monto: "0.00", regla, tramo: "SIN_RETENCION", fijo: "0.00", variable: "0.00" });
  if (entrada.regimenFiscal === "PEQUENO_CONTRIBUYENTE") return sinRetencion(`${REGLA_ISR_VERSION}:PEQUENO_CONTRIBUYENTE_SIN_RETENCION`);
  if (!entrada.sujetoIsr) return sinRetencion(`${REGLA_ISR_VERSION}:NO_SUJETO_ISR`);
  const t = isrExacto(base);
  let monto = t.exacto;
  if (monto.decimalPlaces() > 2) {
    if (redondeoFraccionCentavo === undefined) throw new ReglaIsrPendiente("REDONDEO", `ISR exacto Q${monto.toString()}`);
    monto = monto.toDecimalPlaces(2, redondeoFraccionCentavo);
  }
  return {
    porcentaje: t.porcentaje, monto: monto.toFixed(2), regla: REGLA_POR_TRAMO[t.tramo], tramo: t.tramo,
    fijo: t.fijo.toFixed(2), variable: monto.minus(t.fijo).toFixed(2),
  };
}
