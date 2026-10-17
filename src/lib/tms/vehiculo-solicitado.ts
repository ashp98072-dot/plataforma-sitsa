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

/** Mensaje único (frontend y backend) cuando falta el vehículo solicitado. */
export const MSG_VEHICULO_SOLICITADO_OBLIGATORIO = "Selecciona el vehículo solicitado por el cliente.";

/**
 * ¿Al guardar CAMBIOS de un viaje existente se exige tener un vehículo solicitado? Solo cuando el campo es EDITABLE: un viaje Cerrado/Cancelado no
 * admite modificaciones y uno "En ruta" sin llegada solo admite notas (el selector está bloqueado: exigirlo sería imposible de cumplir).
 * Los viajes históricos (sin dato) se pueden CONSULTAR siempre; solo se exige elegir uno al guardar cambios en estados editables.
 */
export function exigeVehiculoSolicitadoAlEditar(estado: string, pendienteCierre: boolean): boolean {
  if (estado === "Cerrado" || estado === "Cancelado") return false;
  if (estado === "En ruta" && !pendienteCierre) return false;
  return true;
}

/**
 * ¿Este PATCH es una EDICIÓN de datos del viaje (y por tanto exige vehículo) o solo una transición de estado/motivo? Marcar «Cargado» y «Cancelar» van
 * por el mismo endpoint pero no editan datos: nunca se bloquean por la falta histórica del vehículo.
 */
export function esPatchDeEdicion(d: Record<string, unknown>): boolean {
  if (d.estado === "Cancelado") return false;
  return Object.entries(d).some(([k, v]) => v !== undefined && !["id", "estado", "motivoCambio"].includes(k));
}

/** Vehículo EFECTIVO tras el PATCH: el que trae (null lo quita) o, si no lo toca, el que ya tenía el viaje. */
export function vehiculoEfectivoTrasPatch(enPatch: number | null | undefined, actual: number | null | undefined): number | null {
  return enPatch !== undefined ? enPatch : (actual ?? null);
}

function claveVehiculo(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export type ResolucionVehiculoPorTexto =
  | { ok: true; vehiculo: { id: number; nombre: string } }
  | { ok: false; motivo: "vacio" | "no_existe" | "ambiguo" };

/**
 * Importación Excel: identifica el perfil por su NOMBRE exacto o su CÓDIGO (sin importar mayúsculas, acentos ni espacios
 * repetidos) dentro del catálogo ACTIVO de la empresa que se le pasa. Nunca adivina: texto vacío, sin coincidencia o con
 * más de un perfil posible es un rechazo; no se infiere desde la placa, unidad ni tarifa.
 */
export function resolverVehiculoPorTexto(texto: string | null | undefined, catalogoActivo: VehiculoSolicitadoOpcion[]): ResolucionVehiculoPorTexto {
  const clave = claveVehiculo(texto ?? "");
  if (!clave) return { ok: false, motivo: "vacio" };
  const coincidencias = catalogoActivo.filter((o) => claveVehiculo(o.nombre) === clave || claveVehiculo(o.codigo) === clave);
  const ids = new Set(coincidencias.map((o) => o.id));
  if (ids.size === 0) return { ok: false, motivo: "no_existe" };
  if (ids.size > 1) return { ok: false, motivo: "ambiguo" };
  return { ok: true, vehiculo: { id: coincidencias[0].id, nombre: coincidencias[0].nombre } };
}
