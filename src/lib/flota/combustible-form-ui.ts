/**
 * FLOTA-COMBUSTIBLE-2 — lógica pura (sin React, sin fetch) del
 * formulario de combustible del Portal: (sección 4) cálculo del total
 * estimado (galones × precio por galón) y su comparación contra el
 * monto que el piloto ingresó del vale; (sección 2, ajuste pre-merge)
 * validación de que la fecha de consumo sea una fecha calendario real.
 * Se extrae aparte para poder probarla con vitest — mismo criterio que
 * historial-firmas-ui.ts / viajes-portal-ui.ts en este proyecto: el
 * proyecto no tiene infraestructura de pruebas de componentes React.
 *
 * El total estimado nunca reemplaza el monto ingresado por el piloto —
 * solo informa. El servidor tampoco recalcula ni rechaza por esta
 * diferencia (ver route.ts) — "no inventar reglas de rechazo automático
 * sin autorización".
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

/**
 * AJUSTE PRE-MERGE (PR #192, sección 2) — ¿`valor` es una fecha
 * calendario REAL en formato "YYYY-MM-DD"? Rechaza fechas que el
 * formato/regex dejaría pasar pero que no existen en el calendario
 * (ej. "2026-02-31", "2026-04-31", "2026-02-29" en un año no bisiesto).
 *
 * `new Date("2026-02-31").getTime()` NO es NaN — el constructor de Date
 * NORMALIZA silenciosamente el día fuera de rango, rodando hacia el mes
 * siguiente (2026-02-31 se vuelve 2026-03-03) — un chequeo ingenuo con
 * solo `!Number.isNaN(new Date(valor).getTime())` no basta y deja pasar
 * fechas imposibles (bug real encontrado en revisión contra el Excel de
 * la gasolinera). Se reconstruye con Date.UTC() y se confirma que año/
 * mes/día no cambiaron — mismo patrón ya usado en el proyecto
 * (esFechaValida en rrhh/empleado-api-schema.ts, esFechaCalendarioValida
 * en tms/solicitudes-cliente.ts): no existe un helper YA EXPORTADO y
 * compartido para esto (ambos son funciones privadas locales a su
 * módulo), así que se sigue el mismo criterio de duplicar una función
 * pequeña y pura por dominio en vez de inventar un import cruzado nuevo.
 */
export function esFechaCalendarioValida(valor: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor);
  if (!m) return false;
  const [, y, mo, d] = m;
  const anio = Number(y);
  const mes = Number(mo);
  const dia = Number(d);
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return false;
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  return (
    fecha.getUTCFullYear() === anio &&
    fecha.getUTCMonth() === mes - 1 &&
    fecha.getUTCDate() === dia
  );
}
