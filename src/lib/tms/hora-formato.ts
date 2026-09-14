/**
 * OPERACIONES-HORA-12H-1 — helpers de PRESENTACIÓN para que el módulo de
 * Operaciones muestre/edite horas en formato 12h con AM/PM, sin cambiar
 * NUNCA el formato interno: la aplicación sigue guardando/enviando
 * `HH:mm` (24h) exactamente como hoy — estos helpers son funciones puras
 * string <-> objeto, nunca tocan BD ni API, nunca lanzan (una entrada
 * inválida se trata igual que una ausente: "—" / `null`, nunca se
 * inventa un valor).
 *
 * Aceptan `HH:mm` o `HH:mm:ss` de entrada (los segundos se ignoran) —
 * mismo criterio defensivo que ya usa plan-form.tsx con `.slice(0, 5)`
 * sobre `tms_planes_viaje.hora_carga`.
 *
 * Fase 1 (Grupo A + B, PR 1): solo horas "programadas" (`HH:mm` plano,
 * sin componente de fecha) — `hora_carga`, `hora_habitual`,
 * `hora_solicitada`. Las horas "reales" derivadas de un `DATETIME`
 * completo (`flota_viajes.hora_salida`/`hora_llegada`) quedan para un PR
 * separado (Grupo C), que reutilizará la normalización ya existente en
 * `src/lib/rrhh/dates.ts` (`fmtTs`/`horaCorta`) para extraer primero el
 * `HH:mm` antes de pasarlo por `formatearHora12`.
 */

const PATRON_HORA_24 = /^([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/;

function parsearComponentes24(hora24: string | null | undefined): { hora: number; minuto: number } | null {
  if (!hora24) return null;
  const m = hora24.trim().match(PATRON_HORA_24);
  if (!m) return null;
  return { hora: Number(m[1]), minuto: Number(m[2]) };
}

/**
 * `HH:mm` (24h) -> `"hh:mm AM/PM"`. `null`/vacío/inválido -> `"—"` (mismo
 * criterio que `formatearTimestampVisible`/`formatearFechaVisible` en
 * rrhh/dates.ts: nunca revienta, nunca inventa un valor).
 *
 * Reglas verificadas: `00:00` -> `12:00 AM`; `08:00` -> `08:00 AM`;
 * `12:00` -> `12:00 PM`; `13:00` -> `01:00 PM`; `23:59` -> `11:59 PM`.
 */
export function formatearHora12(hora24: string | null | undefined): string {
  const partes = parsearComponentes24(hora24);
  if (!partes) return "—";
  const { hora, minuto } = partes;
  const ampm = hora < 12 ? "AM" : "PM";
  const hora12 = hora % 12 === 0 ? 12 : hora % 12;
  return `${String(hora12).padStart(2, "0")}:${String(minuto).padStart(2, "0")} ${ampm}`;
}

/**
 * `HH:mm` (24h) -> partes 12h, para precargar el selector de 3 columnas
 * (`Hora12Input`) al editar un registro existente. `null`/vacío/inválido
 * -> `null` (el llamador decide el valor por defecto a mostrar, nunca se
 * inventa aquí).
 */
export function parsearHora12(
  hora24: string | null | undefined,
): { hora: number; minuto: number; ampm: "AM" | "PM" } | null {
  const partes = parsearComponentes24(hora24);
  if (!partes) return null;
  const { hora, minuto } = partes;
  const ampm: "AM" | "PM" = hora < 12 ? "AM" : "PM";
  const hora12 = hora % 12 === 0 ? 12 : hora % 12;
  return { hora: hora12, minuto, ampm };
}

/**
 * Partes 12h (hora 1-12, minuto 0-59, AM/PM) -> `HH:mm` (24h) — el valor
 * que de verdad se guarda/envía. Nunca lanza: valores fuera de rango se
 * acotan (`hora` a 1-12, `minuto` a 0-59) en vez de producir un `HH:mm`
 * inválido — el selector de 3 `<select>` nunca puede producir un valor
 * fuera de rango de todas formas, esto es solo defensa adicional.
 *
 * Inversas verificadas: `12:00 AM` -> `00:00`; `12:00 PM` -> `12:00`;
 * `01:00 PM` -> `13:00`.
 */
export function combinarHora12(hora: number, minuto: number, ampm: "AM" | "PM"): string {
  const h = Math.min(12, Math.max(1, Math.round(hora)));
  const m = Math.min(59, Math.max(0, Math.round(minuto)));
  const hora24 = (h % 12) + (ampm === "PM" ? 12 : 0);
  return `${String(hora24).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
