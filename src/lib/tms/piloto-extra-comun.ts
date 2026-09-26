/**
 * PILOTO EXTRA — piezas PURAS (sin BD) compartidas por servidor y formularios/cliente. La lógica con base de datos vive en
 * `piloto-extra.ts` (que las re-exporta).
 */

/** Límite actual de negocio: 1 piloto principal + como máximo 1 piloto extra (el esquema admite más filas; la app no). */
export const MAX_PILOTOS_EXTRA = 1;

export const MSG_PERSONA_DUPLICADA = "Una persona no puede estar asignada más de una vez al mismo viaje.";
export const MSG_EXTRA_SOLO_PROPIO = "El piloto extra solo aplica a viajes Propios (un viaje tercerizado usa el nombre del piloto externo).";
export const MSG_EXTRA_INVALIDO = "El piloto extra debe ser un empleado activo de la empresa con puesto de piloto.";

/** ¿Alguien aparece dos veces entre principal, extra y auxiliares? (pura; ids de tms_personal o de empleado, según el llamador). */
export function hayPersonaDuplicada(principal: number | null | undefined, extra: number | null | undefined, auxiliares: readonly number[]): boolean {
  const vistos = new Set<number>();
  for (const id of [principal, extra, ...auxiliares]) {
    if (id == null) continue;
    if (vistos.has(id)) return true;
    vistos.add(id);
  }
  return false;
}

/** Texto para reportes: "Juan Pérez / Carlos López" (solo el principal, exactamente como antes, si no hay extra). */
export function textoPilotos(principal: string | null | undefined, extra: string | null | undefined): string {
  return [principal, extra].map((n) => (n ?? "").trim()).filter(Boolean).join(" / ");
}

/** Línea del mensaje de asignación: "Piloto: X" (uno) o "Pilotos: X, Y" (con piloto extra). */
export function lineaPilotosMensaje(principal: string | null | undefined, extra: string | null | undefined): string {
  const p = (principal ?? "").trim();
  const e = (extra ?? "").trim();
  if (p && e) return `Pilotos: ${p}, ${e}`;
  if (e) return `Pilotos: ${e}`;
  return `Piloto: ${p || "Pendiente"}`;
}
