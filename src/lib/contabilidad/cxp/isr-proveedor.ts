import Decimal from "decimal.js";

/**
 * M-3A — Retención de ISR a proveedores al REGISTRAR una factura normal (lógica PURA, sin BD).
 *
 * ÚNICA REGLA CONFIRMADA por Contabilidad que se codifica:
 *  - Proveedor sujeto a ISR con valor neto (base sin IVA) de Q2,800.00 a Q29,999.00 → 5 % sobre ese valor neto.
 *  - Pequeño contribuyente → sin retención. Proveedor NO sujeto a ISR (configuración explícita) → sin retención.
 *  - La empresa no retiene IVA en una factura normal de proveedor.
 *
 * TODO LO DEMÁS ESTÁ PENDIENTE Y SE BLOQUEA (`ReglaIsrPendiente`, 422, no se escribe nada) en vez de asumirlo:
 *  - BASE_BAJO_MINIMO: base menor a Q2,800.00 de un sujeto de ISR. Contabilidad no dijo si es «sin retención»; no se interpreta.
 *  - BASE_SOBRE_TRAMO: base mayor a Q29,999.00 (incluye el hueco 29,999.01–29,999.99 y «desde Q30,000.00 → 7 %», fórmula sin definir).
 *  - REDONDEO: el 5 % no es un importe exacto en centavos (p. ej. base Q2,800.10 → Q140.005). La regla de redondeo fiscal no está
 *    confirmada, así que NO se fija ninguna (ni mitad arriba, ni abajo, ni truncar): solo se registran los casos exactos.
 *  - Factura especial: IVA e ISR «sobre la base del pago» → fase de pagos.
 * Cuando Contabilidad responda, se cambia ESTE módulo (y su versión) y se levanta el bloqueo; las facturas ya registradas conservan la
 * `regla_isr` con la que se calcularon.
 */
export const REGLA_ISR_VERSION = "M3A_V2";
export const ISR_BASE_MINIMA = "2800.00";
export const ISR_TRAMO_5_MAXIMO = "29999.00";
export const ISR_TRAMO_5_PORCENTAJE = "5.00";

export const REGIMENES_FISCALES = ["GENERAL", "PEQUENO_CONTRIBUYENTE"] as const;
export type RegimenFiscal = (typeof REGIMENES_FISCALES)[number];

export type ReglaIsrAplicada =
  | `${typeof REGLA_ISR_VERSION}:PEQUENO_CONTRIBUYENTE_SIN_RETENCION`
  | `${typeof REGLA_ISR_VERSION}:NO_SUJETO_ISR`
  | `${typeof REGLA_ISR_VERSION}:TRAMO_5_PCT_EXACTO`;

export type MotivoReglaPendiente = "BASE_BAJO_MINIMO" | "BASE_SOBRE_TRAMO" | "REDONDEO";
const MENSAJES: Record<MotivoReglaPendiente, string> = {
  BASE_BAJO_MINIMO: "Retención de ISR pendiente de confirmación de Contabilidad: para un proveedor sujeto a ISR con base menor a Q2,800.00 no se ha definido el tratamiento. La factura no se registra hasta definirlo.",
  BASE_SOBRE_TRAMO: "Retención de ISR pendiente de confirmación de Contabilidad: para una base mayor a Q29,999.00 (desde Q30,000.00 aplica 7 % con fórmula no definida) no hay regla. La factura no se registra hasta definirla.",
  REDONDEO: "Retención de ISR pendiente de confirmación de Contabilidad: el 5 % de esta base no es un importe exacto en centavos y la regla de redondeo no está definida. La factura no se registra hasta definirla.",
};

/** La regla aplicable existe en el negocio pero Contabilidad aún no confirmó su fórmula: la operación se rechaza, no se aproxima. */
export class ReglaIsrPendiente extends Error {
  readonly codigo = "REGLA_ISR_PENDIENTE";
  readonly status = 422;
  constructor(readonly motivo: MotivoReglaPendiente) {
    super(MENSAJES[motivo]);
    this.name = "ReglaIsrPendiente";
  }
}

export type EntradaIsr = { baseNeto: string; regimenFiscal: RegimenFiscal; sujetoIsr: boolean };
export type ResultadoIsr = { porcentaje: string; monto: string; regla: ReglaIsrAplicada };

export function calcularIsrProveedor(entrada: EntradaIsr): ResultadoIsr {
  const base = new Decimal(entrada.baseNeto);
  if (!base.isFinite() || base.lte(0)) throw new RangeError("La base neta debe ser mayor que cero.");
  if (entrada.regimenFiscal === "PEQUENO_CONTRIBUYENTE") {
    return { porcentaje: "0.00", monto: "0.00", regla: `${REGLA_ISR_VERSION}:PEQUENO_CONTRIBUYENTE_SIN_RETENCION` };
  }
  if (!entrada.sujetoIsr) return { porcentaje: "0.00", monto: "0.00", regla: `${REGLA_ISR_VERSION}:NO_SUJETO_ISR` };
  if (base.lt(ISR_BASE_MINIMA)) throw new ReglaIsrPendiente("BASE_BAJO_MINIMO");
  if (base.gt(ISR_TRAMO_5_MAXIMO)) throw new ReglaIsrPendiente("BASE_SOBRE_TRAMO");
  const exacto = base.times(ISR_TRAMO_5_PORCENTAJE).div(100);
  if (exacto.decimalPlaces() > 2) throw new ReglaIsrPendiente("REDONDEO");
  return { porcentaje: ISR_TRAMO_5_PORCENTAJE, monto: exacto.toFixed(2), regla: `${REGLA_ISR_VERSION}:TRAMO_5_PCT_EXACTO` };
}
