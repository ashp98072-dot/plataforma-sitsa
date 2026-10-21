import type { EstadoDocumentoFel, EstadoIntentoFel } from "./tipos";

/**
 * Máquina de estados fiscal (pura, sin BD). Un único lugar decide qué resultado del proveedor mueve qué estado.
 *
 *   PENDIENTE ──CERTIFICADO──▶ CERTIFICADO ──ANULADO (solo con respuesta válida del proveedor)──▶ ANULADO
 *   PENDIENTE ──RECHAZADO───▶ RECHAZADO (terminal)
 *   PENDIENTE ──INCIERTO────▶ INCIERTO ──consulta: CERTIFICADO | RECHAZADO | NO_ENCONTRADO | (sigue INCIERTO)
 *   NO_ENCONTRADO ──reenvío idéntico (misma referencia y DTO)──▶ PENDIENTE
 *
 * Reglas duras: CERTIFICADO, RECHAZADO y ANULADO no regresan a ningún estado previo; NO_ENCONTRADO solo nace de una
 * consulta; un resultado que no es de consulta jamás produce NO_ENCONTRADO.
 */

export type OrigenResultado = "CERTIFICAR" | "CONSULTAR";
export type ResultadoProveedorEstado = "CERTIFICADO" | "RECHAZADO" | "PENDIENTE" | "NO_ENCONTRADO" | "INCIERTO" | "ERROR_CONFIG";

/** Estado del documento tras aplicar el resultado, o null si el resultado no es aplicable (no se debe mutar nada). */
export function estadoTrasResultado(
  actual: EstadoDocumentoFel,
  origen: OrigenResultado,
  resultado: ResultadoProveedorEstado,
): EstadoDocumentoFel | null {
  if (actual === "CERTIFICADO" || actual === "ANULADO" || actual === "RECHAZADO") return null;
  switch (resultado) {
    case "CERTIFICADO":
      return "CERTIFICADO";
    case "RECHAZADO":
      return "RECHAZADO";
    case "NO_ENCONTRADO":
      // Solo la CONSULTA puede afirmar que no existe. Si algo más lo reporta, es incertidumbre, nunca «no existe».
      return origen === "CONSULTAR" ? "NO_ENCONTRADO" : "INCIERTO";
    case "PENDIENTE":
      // El certificador lo tiene en proceso: se conserva la incertidumbre previa (INCIERTO sigue INCIERTO).
      return actual === "INCIERTO" ? "INCIERTO" : "PENDIENTE";
    case "INCIERTO":
    case "ERROR_CONFIG":
      // ERROR_CONFIG devuelto al enviar no prueba que nada se procesó: se conserva como incierto (conservador).
      return "INCIERTO";
  }
}

export function estadoIntentoDe(resultado: ResultadoProveedorEstado, origen: OrigenResultado): EstadoIntentoFel {
  if (resultado === "NO_ENCONTRADO" && origen !== "CONSULTAR") return "INCIERTO";
  return resultado;
}

/** Estados desde los que NUNCA se envía a certificar de nuevo sin antes consultar. */
export const ESTADOS_QUE_EXIGEN_CONSULTA: readonly EstadoDocumentoFel[] = ["PENDIENTE", "INCIERTO"];
