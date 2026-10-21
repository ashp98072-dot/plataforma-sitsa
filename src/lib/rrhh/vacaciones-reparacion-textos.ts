/** Textos de los motivos/defectos de la reparación de series de vacaciones (módulo puro, seguro para componentes de cliente). */
export const MOTIVOS_REPARACION: Record<string, string> = {
  FECHA_ALTA_AUSENTE: "sin fecha de contratación",
  FECHA_ALTA_SOSPECHOSA: "fecha de contratación inválida",
  FECHA_ALTA_FUTURA: "fecha de contratación futura",
  ANIO_LABORAL_DUPLICADO: "año laboral duplicado",
  TRASLAPE_REAL: "períodos traslapados",
  PERIODO_FUERA_DE_BASE: "períodos de otra fecha base",
  PERIODO_FALTANTE: "períodos faltantes",
  ANIO_FUERA_DE_SERIE: "año laboral fuera de la serie",
  ANIO_LABORAL_NULO_EN_SERIE: "período sin año laboral",
  ESTRUCTURA_CONGELADA: "sincronización congelada",
};
