/**
 * PROGRAMACION-VEHICULO-SOLICITADO — "Vehículo solicitado por el cliente" (módulo PURO, seguro para componentes
 * cliente). Es un dato COMERCIAL del viaje: lo que el cliente pidió/cotizó (p. ej. 2.5 t), independiente de la unidad
 * que realmente hace el viaje (p. ej. 5 t) y de la tarifa comercial. Catálogo reutilizado: perfiles de costeo de
 * Cotizaciones (tms_cotizacion_costeo_perfiles, por empresa). El viaje guarda el id del perfil + una fotografía de su
 * nombre; los viajes previos a esta funcionalidad no tienen dato y se muestran como "—" (nunca se infiere de la unidad).
 */
export type VehiculoSolicitadoOpcion = { id: number; codigo: string; nombre: string };

export const ETIQUETA_VEHICULO_SOLICITADO = "Vehículo solicitado";
export const ETIQUETA_VEHICULO_SOLICITADO_LARGA = "Vehículo solicitado por el cliente";
export const AYUDA_VEHICULO_SOLICITADO =
  "Vehículo/capacidad solicitada comercialmente por el cliente. Puede ser distinta de la unidad que finalmente realizará el viaje.";

/** Texto a mostrar: la fotografía guardada en el viaje o "—" (históricos sin dato). */
export function textoVehiculoSolicitado(nombre: string | null | undefined): string {
  return nombre?.trim() || "—";
}

/** "C-123ABC — 5 toneladas" (placa + capacidad registrada en Flota de la unidad REAL), o lo que exista. */
export function textoUnidadUtilizada(placa: string | null | undefined, capacidad: string | null | undefined): string {
  const partes = [placa?.trim(), capacidad?.trim()].filter(Boolean);
  return partes.length ? partes.join(" — ") : "—";
}

/**
 * Opciones del selector: perfiles ACTIVOS de la empresa + el valor actual del viaje aunque ya no esté activo (se
 * muestra con su fotografía para no perderlo al editar otros campos).
 */
export function opcionesVehiculoSolicitado(
  catalogo: VehiculoSolicitadoOpcion[],
  actual: { id: number | null | undefined; nombre: string | null | undefined },
): { id: number; etiqueta: string }[] {
  const opciones = catalogo.map((o) => ({ id: o.id, etiqueta: o.nombre }));
  if (actual.id != null && actual.id > 0 && !opciones.some((o) => o.id === actual.id)) {
    opciones.unshift({ id: actual.id, etiqueta: `${textoVehiculoSolicitado(actual.nombre)} (no activo en el catálogo)` });
  }
  return opciones;
}

/**
 * Valor para el PATCH: `undefined` si no cambió (no se envía: no toca el campo ni sus reglas), `null` para quitarlo,
 * o el id nuevo. `seleccionado` 0 = "sin dato".
 */
export function cambioVehiculoSolicitado(original: number | null | undefined, seleccionado: number): number | null | undefined {
  const nuevo = seleccionado > 0 ? seleccionado : null;
  return nuevo === (original ?? null) ? undefined : nuevo;
}
