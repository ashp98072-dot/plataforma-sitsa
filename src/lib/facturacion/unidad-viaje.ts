/**
 * FACTURACIÓN — qué se muestra en la columna «Unidad» de «Viajes pendientes» (función PURA, sin DB).
 *
 * Fuente real en TMS (tms_planes_viaje):
 *   - `tipo_viaje` = 'Propio' | 'Tercerizado' (VARCHAR, DEFAULT 'Propio').
 *   - Propio: la unidad es `unidad_id` → tms_unidades.placa.
 *   - Tercerizado: `unidad_id` queda NULL A PROPÓSITO (el recurso es externo, no existe en el catálogo) y la placa se
 *     captura como texto en `unidad_externa_placa` (se guarda en mayúsculas; es opcional).
 *
 * Prioridad (la misma que ya usan Programación y su reporte: `esTercerizado ? unidad_externa_placa : placa`):
 *   1. Viaje TERCERIZADO → su placa externa si la hay; si no, «Tercerizado» (se sabe con certeza por `tipo_viaje`).
 *   2. Viaje PROPIO      → la placa de su unidad interna; si no tiene unidad, null (la pantalla muestra «—»).
 *
 * Por qué NO «placa interna primero»: en un tercerizado `unidad_id` es NULL por diseño, así que ambas reglas coinciden en
 * los datos normales; si apareciera un `unidad_id` huérfano en un tercerizado, Programación lo ignora (muestra la placa
 * externa), y Facturación debe decir lo mismo que Programación. No se expone nada más del proveedor ni del conductor.
 */
export const TEXTO_UNIDAD_TERCERIZADO = "Tercerizado";

const texto = (v: string | null | undefined): string | null => {
  const t = (v ?? "").trim();
  return t ? t : null;
};

export function resolverUnidadViaje(input: {
  tipoViaje: string | null | undefined;
  placaInterna: string | null | undefined;
  placaExterna: string | null | undefined;
}): string | null {
  if (input.tipoViaje === "Tercerizado") return texto(input.placaExterna) ?? TEXTO_UNIDAD_TERCERIZADO;
  return texto(input.placaInterna);
}
