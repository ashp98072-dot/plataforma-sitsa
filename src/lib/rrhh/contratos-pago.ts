/** Tipos de contrato y formas de pago RRHH (Guatemala / SITSA). */

export const TIPOS_CONTRATO = [
  { value: "fijo", label: "Fijo (contratado)" },
  { value: "prueba", label: "Periodo de prueba" },
  { value: "temporal", label: "Temporal" },
  {
    value: "outsourcing",
    label: "Outsourcing (sin contrato formal · pago operativo)",
  },
] as const;

export type TipoContrato = (typeof TIPOS_CONTRATO)[number]["value"];

export const FORMAS_PAGO = [
  { value: "transferencia", label: "Transferencia bancaria" },
  { value: "cheque", label: "Cheque" },
  { value: "efectivo", label: "Efectivo" },
] as const;

export type FormaPago = (typeof FORMAS_PAGO)[number]["value"];

export const ESTADOS_PAGO_PLANILLA = [
  "Pendiente",
  "Pagado",
] as const;

export type EstadoPagoPlanilla = (typeof ESTADOS_PAGO_PLANILLA)[number];

/** IGSS laboral (trabajador) — % sobre sueldo ordinario (sin bono incentivo). */
export const IGSS_LABORAL_PCT = 0.0483;
/** IGSS patronal + IRTRA/INTECAP aproximado (costo empleador, no se descuenta al trabajador). */
export const IGSS_PATRONAL_PCT = 0.1267;

export function normalizarFormaPago(raw: string | null | undefined): FormaPago {
  const v = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (v === "cheque") return "cheque";
  if (v === "efectivo" || v === "cash") return "efectivo";
  return "transferencia";
}

export function normalizarTipoContrato(
  raw: string | null | undefined,
): TipoContrato {
  const v = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (v === "prueba") return "prueba";
  if (v === "temporal") return "temporal";
  if (v === "outsourcing" || v === "outsorcing" || v === "absorbing") {
    return "outsourcing";
  }
  return "fijo";
}

/**
 * Determina si un tipo de contrato (crudo o ya normalizado) corresponde a
 * outsourcing. Usa la misma normalización que normalizarTipoContrato, por lo
 * que reconoce también los typos conocidos en datos reales ("outsorcing",
 * "absorbing"), evitando que un registro con un typo se salte cálculos de
 * nómina como el descuento de IGSS.
 */
export function esOutsourcing(tipo: string | null | undefined): boolean {
  return normalizarTipoContrato(tipo) === "outsourcing";
}

export function etiquetaTipoContrato(raw: string | null | undefined): string {
  const t = normalizarTipoContrato(raw);
  return TIPOS_CONTRATO.find((x) => x.value === t)?.label ?? t;
}

export function etiquetaFormaPago(raw: string | null | undefined): string {
  const f = normalizarFormaPago(raw);
  return FORMAS_PAGO.find((x) => x.value === f)?.label ?? f;
}

export function redondearQ(n: number): number {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}