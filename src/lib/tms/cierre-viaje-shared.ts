/** Estados desde los que Operaciones puede solicitar un cierre manual. */
export const ESTADOS_CIERRE_MANUAL = ["Programado", "Cargado", "En ruta"] as const;

/**
 * SECUENCIA DE OPERACIONES: viaje realizado → REPORTE RECIBIDO → ajustes/cargos → CERRAR → liquidar → facturación.
 * Un viaje solo puede pasar a `Cerrado` si su liquidación (`tms_viaje_liquidaciones.estado`) es EXACTAMENTE
 * `REPORTE_RECIBIDO`. Sin fila de liquidación = reporte no recibido. `EN_AJUSTE` y `LIQUIDADO` son etapas POSTERIORES al
 * cierre y NUNCA habilitan un cierre inicial. Aplica a TODOS los caminos de cierre (normal, manual, masivo y por período).
 */
export const ESTADO_LIQUIDACION_REQUERIDA_PARA_CIERRE = "REPORTE_RECIBIDO" as const;
export const CODIGO_REPORTE_NO_RECIBIDO = "REPORTE_NO_RECIBIDO" as const;
export const MENSAJE_REPORTE_NO_RECIBIDO = "No se puede cerrar el viaje porque el reporte aún no ha sido recibido.";
/** Texto corto de la acción deshabilitada en pantalla. */
export const MENSAJE_CONFIRMAR_REPORTE_PRIMERO = "Confirme primero la recepción del reporte.";

/**
 * ¿El reporte FUE RECIBIDO? (no «¿el estado actual es exactamente REPORTE_RECIBIDO?»). Habilita el cierre:
 *   - la liquidación ACTUAL está en REPORTE_RECIBIDO; o
 *   - existe el evento append-only `REPORTE_RECIBIDO` de ese plan (`eventoReporteRecibido`): fuente AUTORITATIVA para planes
 *     heredados que ya avanzaron (EN_AJUSTE / LIQUIDADO) antes de exigir el cierre previo.
 * Sin fila ni evento ⇒ NO. `EN_AJUSTE` o `LIQUIDADO` por sí solos NUNCA habilitan: sin el evento histórico no hay evidencia de
 * que el reporte se haya recibido. Para planes nuevos el flujo sigue siendo REPORTE_RECIBIDO → Cerrar → Liquidar.
 */
export function reporteRecibidoParaCierre(estadoLiquidacion: string | null | undefined, eventoReporteRecibido = false): boolean {
  return estadoLiquidacion === ESTADO_LIQUIDACION_REQUERIDA_PARA_CIERRE || eventoReporteRecibido === true;
}

/** Igual, desde el resumen de liquidación de una fila de la tabla (`reporteRecibido` = evento histórico, calculado en servidor). */
export function reporteRecibidoDeLiquidacion(l: { estado: string; reporteRecibido?: boolean } | null | undefined): boolean {
  return l ? reporteRecibidoParaCierre(l.estado, l.reporteRecibido === true) : false;
}

/**
 * PLANES-TARIFA-CIERRE-1 — ningún viaje puede pasar a Cerrado sin una tarifa comercial asignada
 * (tms_planes_viaje.tarifa_comercial). `tieneTarifa` SIEMPRE significa `tarifa_comercial !== null` —
 * NUNCA `> 0`: una tarifa capturada como Q0.00 sigue siendo un valor explícito, no "sin tarifa". El caller
 * calcula `tieneTarifa` a partir del dato real leído de BD (nunca confiado del cliente).
 */

/** Criterio puro compartido por la interfaz y el backend. */
export function puedeCerrarManualmente(estado: string, tieneTarifa: boolean, reporteRecibido: boolean): boolean {
  return reporteRecibido && tieneTarifa && (ESTADOS_CIERRE_MANUAL as readonly string[]).includes(estado);
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

export function puedeCerrarNormalmente(estado: string, llegadaRegistrada: boolean, tieneTarifa: boolean, reporteRecibido: boolean): boolean {
  if (!reporteRecibido) return false; // sin REPORTE_RECIBIDO ningún estado es elegible para cierre
  if (!tieneTarifa) return false;
  if ((ESTADOS_CIERRE_NORMAL_SIN_LLEGADA as readonly string[]).includes(estado)) return true;
  return llegadaRegistrada && (ESTADOS_CIERRE_NORMAL_CON_LLEGADA as readonly string[]).includes(estado);
}

/** null si el cierre normal procede; si no, el motivo legible (mismo criterio que los mensajes de cerrarViaje). */
export function motivoNoCierreNormal(estado: string, llegadaRegistrada: boolean, tieneTarifa: boolean, reporteRecibido: boolean): string | null {
  if (puedeCerrarNormalmente(estado, llegadaRegistrada, tieneTarifa, reporteRecibido)) return null;
  if (estado === "Cerrado") return "Este viaje ya fue cerrado.";
  if (estado === "Cancelado") return "Este viaje está cancelado; no admite cierre.";
  if (!tieneTarifa) return "No se puede cerrar este viaje porque todavía no tiene una tarifa asignada.";
  if ((ESTADOS_CIERRE_NORMAL_CON_LLEGADA as readonly string[]).includes(estado) && !llegadaRegistrada) {
    return "El piloto todavía no ha registrado la llegada de este viaje; no se puede cerrar todavía (usa el cierre manual).";
  }
  const estadoElegible =
    (ESTADOS_CIERRE_NORMAL_SIN_LLEGADA as readonly string[]).includes(estado) ||
    ((ESTADOS_CIERRE_NORMAL_CON_LLEGADA as readonly string[]).includes(estado) && llegadaRegistrada);
  // Elegible por estado/llegada/tarifa pero sin REPORTE_RECIBIDO: el reporte es el último requisito del cierre.
  if (estadoElegible && !reporteRecibido) return MENSAJE_REPORTE_NO_RECIBIDO;
  return `Este viaje está "${estado}"; el cierre normal solo aplica con llegada registrada (usa el cierre manual).`;
}

/** null si el cierre manual procede; si no, el motivo legible (mismo criterio que cerrarViajeManual). */
export function motivoNoCierreManual(estado: string, tieneTarifa: boolean, reporteRecibido: boolean): string | null {
  if (puedeCerrarManualmente(estado, tieneTarifa, reporteRecibido)) return null;
  if (estado === "Cerrado") return "Este viaje ya fue cerrado.";
  if (estado === "Cancelado") return "Este viaje está cancelado; no admite cierre manual.";
  if (!tieneTarifa) return "No se puede cerrar este viaje porque todavía no tiene una tarifa asignada.";
  if (!(ESTADOS_CIERRE_MANUAL as readonly string[]).includes(estado)) return `Este viaje está "${estado}"; no admite cierre manual.`;
  return MENSAJE_REPORTE_NO_RECIBIDO; // estado y tarifa elegibles, falta REPORTE_RECIBIDO
}
