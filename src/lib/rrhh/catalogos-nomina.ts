/**
 * Catálogo estándar de conceptos de nómina (Fase Gap 3 — roadmap RRHH).
 *
 * Estas listas alimentan los selects de Prestaciones (devengados) y
 * Descuentos, pero los campos de base de datos (rrhh_prestaciones.tipo,
 * rrhh_descuentos.concepto) siguen siendo VARCHAR de texto libre — no se
 * tocó el schema. Por eso "Otro" sigue disponible con texto libre: no se
 * pierde flexibilidad, solo se estandariza lo común para evitar variantes
 * tipo "Bono14" vs "Bono 14" vs "bono catorce" escritas a mano.
 *
 * horas-extra.ts inserta 'Horas extra' directamente en rrhh_prestaciones
 * sin pasar por este catálogo/UI — se incluye aquí solo como referencia,
 * para que aparezca de forma consistente si alguna vez se lista por tipo.
 */

export const TIPOS_DEVENGADO = [
  "Bono",
  "Aguinaldo",
  "Bono14",
  "Indemnización",
  "Viáticos",
  "Bono día festivo/domingo trabajado",
  "Horas extra",
  "Otro",
] as const;

export type TipoDevengado = (typeof TIPOS_DEVENGADO)[number];

export const CONCEPTOS_DESCUENTO = [
  "Uniformes",
  "IGSS voluntario",
  "Séptimo día",
  "Préstamo",
  "Anticipo de sueldo",
  "Multa/Sanción",
  "Otro",
] as const;

export type ConceptoDescuento = (typeof CONCEPTOS_DESCUENTO)[number];