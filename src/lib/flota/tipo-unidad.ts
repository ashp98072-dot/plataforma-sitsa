/**
 * PROGRAMACION-TC-CAJA-REMOLQUE-1 — clasificación formal de una unidad de
 * Flota: `flota_vehiculos.tipo_unidad`. Módulo PURO (sin BD, seguro para
 * importar desde componentes cliente).
 *
 * Antes de este ticket NO existía ninguna marca que distinguiera un camión
 * normal, un cabezal y un TC/caja/remolque (flota_vehiculos no tiene
 * tipo/clase/categoría; tms_unidades.tipo es siempre 'Camion'). Por eso el
 * TC NUNCA se infiere de la placa, marca, modelo o descripción: solo cuenta
 * lo que se clasificó explícitamente.
 *
 * Catálogo validado aquí (sin CHECK en la BD), mismo criterio que
 * tms_planes_viaje.tipo_viaje. Cualquier valor desconocido o ausente (fila
 * legada, columna aún no migrada) se trata como 'VEHICULO' — el
 * comportamiento de siempre.
 */
export const TIPOS_UNIDAD = ["VEHICULO", "CABEZAL", "TC"] as const;
export type TipoUnidad = (typeof TIPOS_UNIDAD)[number];

export const ETIQUETA_TIPO_UNIDAD: Record<TipoUnidad, string> = {
  VEHICULO: "Vehículo",
  CABEZAL: "Cabezal",
  TC: "TC / caja / remolque",
};

export function normalizarTipoUnidad(valor: unknown): TipoUnidad {
  const v = String(valor ?? "").trim().toUpperCase();
  return (TIPOS_UNIDAD as readonly string[]).includes(v) ? (v as TipoUnidad) : "VEHICULO";
}

export function esTc(valor: unknown): boolean {
  return normalizarTipoUnidad(valor) === "TC";
}
