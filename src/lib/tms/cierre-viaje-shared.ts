/** Estados desde los que Operaciones puede solicitar un cierre manual. */
export const ESTADOS_CIERRE_MANUAL = ["Programado", "Cargado", "En ruta"] as const;

/**
 * PLANES-TARIFA-CIERRE-1 — ningún viaje puede pasar a Cerrado sin una tarifa comercial asignada
 * (tms_planes_viaje.tarifa_comercial). `tieneTarifa` SIEMPRE significa `tarifa_comercial !== null` —
 * NUNCA `> 0`: una tarifa capturada como Q0.00 sigue siendo un valor explícito, no "sin tarifa". El caller
 * calcula `tieneTarifa` a partir del dato real leído de BD (nunca confiado del cliente).
 */

/** Criterio puro compartido por la interfaz y el backend. */
export function puedeCerrarManualmente(estado: string, tieneTarifa: boolean): boolean {
  return tieneTarifa && (ESTADOS_CIERRE_MANUAL as readonly string[]).includes(estado);
}

/**
 * Elegibilidad del cierre NORMAL (cerrarViaje en cierre-viaje.ts) — MISMA
 * regla que su UPDATE condicional:
 *  - Descargado: siempre (compatibilidad con el flujo anterior).
 *  - En ruta / Cargado: solo si ya existe llegada real (flota_viajes
 *    'cerrado' para ese plan).
 * Nada más (Programado, Cerrado y Cancelado nunca). Compartida por la
 * pantalla, el endpoint masivo y las pruebas; un test verifica que el SQL de
 * cerrarViaje siga usando exactamente estos estados para que no diverjan.
 *
 * PLANES-TARIFA-CIERRE-1 — además exige `tieneTarifa` (ver nota arriba): sin tarifa, NINGÚN estado es
 * elegible para cierre normal, sin importar llegada registrada.
 */
export const ESTADOS_CIERRE_NORMAL_SIN_LLEGADA = ["Descargado"] as const;
export const ESTADOS_CIERRE_NORMAL_CON_LLEGADA = ["En ruta", "Cargado"] as const;

export function puedeCerrarNormalmente(estado: string, llegadaRegistrada: boolean, tieneTarifa: boolean): boolean {
  if (!tieneTarifa) return false;
  if ((ESTADOS_CIERRE_NORMAL_SIN_LLEGADA as readonly string[]).includes(estado)) return true;
  return llegadaRegistrada && (ESTADOS_CIERRE_NORMAL_CON_LLEGADA as readonly string[]).includes(estado);
}

/** null si el cierre normal procede; si no, el motivo legible (mismo criterio que los mensajes de cerrarViaje). */
export function motivoNoCierreNormal(estado: string, llegadaRegistrada: boolean, tieneTarifa: boolean): string | null {
  if (puedeCerrarNormalmente(estado, llegadaRegistrada, tieneTarifa)) return null;
  if (estado === "Cerrado") return "Este viaje ya fue cerrado.";
  if (estado === "Cancelado") return "Este viaje está cancelado; no admite cierre.";
  if (!tieneTarifa) return "No se puede cerrar este viaje porque todavía no tiene una tarifa asignada.";
  if ((ESTADOS_CIERRE_NORMAL_CON_LLEGADA as readonly string[]).includes(estado)) {
    return "El piloto todavía no ha registrado la llegada de este viaje; no se puede cerrar todavía (usa el cierre manual).";
  }
  return `Este viaje está "${estado}"; el cierre normal solo aplica con llegada registrada (usa el cierre manual).`;
}

/** null si el cierre manual procede; si no, el motivo legible (mismo criterio que cerrarViajeManual). */
export function motivoNoCierreManual(estado: string, tieneTarifa: boolean): string | null {
  if (puedeCerrarManualmente(estado, tieneTarifa)) return null;
  if (estado === "Cerrado") return "Este viaje ya fue cerrado.";
  if (estado === "Cancelado") return "Este viaje está cancelado; no admite cierre manual.";
  if (!tieneTarifa) return "No se puede cerrar este viaje porque todavía no tiene una tarifa asignada.";
  return `Este viaje está "${estado}"; no admite cierre manual.`;
}
