/**
 * PROGRAMACIÓN — regreso estimado opcional + regreso real.
 *
 * Tres datos distintos, que NUNCA se mezclan:
 *   - regreso ESTIMADO (`tms_planes_viaje.regreso_estimado`): dato opcional de
 *     planificación; puede no existir.
 *   - regreso REAL (`flota_viajes.hora_llegada`): llegada física registrada por
 *     Flota/Piloto. Es la única fuente; no se copia a otra tabla.
 *   - cierre ADMINISTRATIVO (`tms_planes_viaje.cerrado_en`): cuándo se cerró el
 *     viaje en Operaciones. NO es una llegada física y jamás se presenta como
 *     tal (ni como "Regreso real").
 *
 * Módulo puro (sin base de datos): lo usan las pantallas, el PDF del viaje y
 * las pruebas.
 */

export const TEXTO_SIN_REGRESO_ESTIMADO = "No indicado";
export const TEXTO_REGRESO_REAL_NO_REGISTRADO = "No registrado";
export const TEXTO_CIERRE_MANUAL = "Cierre manual / sin llegada física registrada";

export type EntradaRegreso = {
  estado: string;
  regresoEstimado: string | null;
  /** flota_viajes.hora_llegada (llegada física), si existe. */
  regresoReal: string | null;
  /** tms_planes_viaje.cerrado_en. */
  cerradoEn: string | null;
  /** El cierre fue manual (cierre_manual = 1). */
  cierreManual?: boolean;
};

export type ResumenRegreso = {
  /** Siempre presente: la fecha formateada o "No indicado". */
  estimado: string;
  /** Fecha real formateada; "No registrado" si el viaje está Cerrado sin llegada física; null mientras el viaje siga abierto (aún no aplica). */
  real: string | null;
  /** Solo si el viaje está Cerrado SIN llegada física: el momento del cierre administrativo (no es una llegada). */
  cierreAdministrativo: string | null;
  /** "Cierre manual / sin llegada física registrada" cuando el cierre fue manual y no hubo llegada física. */
  notaCierreManual: string | null;
};

export function resumenRegreso(e: EntradaRegreso, formato: (valor: string | null) => string): ResumenRegreso {
  const cerrado = e.estado === "Cerrado";
  const sinLlegadaFisica = cerrado && !e.regresoReal;
  return {
    estimado: e.regresoEstimado ? formato(e.regresoEstimado) : TEXTO_SIN_REGRESO_ESTIMADO,
    real: e.regresoReal ? formato(e.regresoReal) : cerrado ? TEXTO_REGRESO_REAL_NO_REGISTRADO : null,
    cierreAdministrativo: sinLlegadaFisica && e.cerradoEn ? formato(e.cerradoEn) : null,
    notaCierreManual: sinLlegadaFisica && e.cierreManual ? TEXTO_CIERRE_MANUAL : null,
  };
}

/**
 * Para un reporte que necesita UNA sola columna "Regreso": prioridad regreso
 * real → regreso estimado → "—", indicando siempre de cuál se trata para que
 * no se confunda un dato planificado con uno ocurrido.
 */
export function regresoUnico(
  regresoReal: string | null,
  regresoEstimado: string | null,
  formato: (valor: string | null) => string,
): { valor: string; tipo: "Real" | "Estimado" | null } {
  if (regresoReal) return { valor: formato(regresoReal), tipo: "Real" };
  if (regresoEstimado) return { valor: formato(regresoEstimado), tipo: "Estimado" };
  return { valor: "—", tipo: null };
}
