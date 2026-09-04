/**
 * FLOTA-COMBUSTIBLE-2 (sección 4) — cálculo del total estimado
 * (galones × precio por galón) y su comparación contra el monto que el
 * piloto ingresó del vale, para el formulario del Portal. Módulo puro
 * (sin React, sin fetch) para poder probarlo con vitest — mismo criterio
 * que historial-firmas-ui.ts / viajes-portal-ui.ts en este proyecto: el
 * proyecto no tiene infraestructura de pruebas de componentes React,
 * así que la lógica que vale la pena probar se extrae aparte.
 *
 * Nunca reemplaza el monto ingresado por el piloto — solo informa. El
 * servidor tampoco recalcula ni rechaza por esta diferencia (ver
 * route.ts) — "no inventar reglas de rechazo automático sin
 * autorización".
 */

/** Tolerancia visual por defecto: Q0.05 — cubre redondeos normales de centavos sin disparar la advertencia por diferencias triviales. */
export const TOLERANCIA_DIFERENCIA_MONTO = 0.05;

/** `galones * precioGalon`, redondeado a centavos. `null` si cualquiera de los dos no es un número finito positivo. */
export function calcularTotalEstimado(galones: number, precioGalon: number): number | null {
  if (!Number.isFinite(galones) || galones <= 0) return null;
  if (!Number.isFinite(precioGalon) || precioGalon <= 0) return null;
  return Math.round(galones * precioGalon * 100) / 100;
}

/** `montoIngresado - totalEstimado`, con signo (positivo = el vale cobró más de lo calculado). `null` si `totalEstimado` es `null`. */
export function calcularDiferenciaMonto(montoIngresado: number, totalEstimado: number | null): number | null {
  if (totalEstimado == null || !Number.isFinite(montoIngresado)) return null;
  return Math.round((montoIngresado - totalEstimado) * 100) / 100;
}

/** ¿La diferencia (con o sin signo) supera la tolerancia visual? `false` si `diferencia` es `null` (nada que advertir todavía). */
export function excedeTolerancia(
  diferencia: number | null,
  tolerancia: number = TOLERANCIA_DIFERENCIA_MONTO,
): boolean {
  if (diferencia == null) return false;
  return Math.abs(diferencia) > tolerancia;
}
