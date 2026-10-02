/**
 * PROGRAMACION-PERSISTENCIA — regla ÚNICA para los lugares de carga/descarga "resumen" del viaje
 * (tms_planes_viaje.lugar_carga_id / lugar_descarga_id, que leen el Portal del piloto y la búsqueda de salida).
 * Se DERIVAN de las paradas del propio viaje — nunca de la ruta maestra ni de otra fuente:
 *   carga    = primera parada tipo "Carga";
 *   descarga = primera parada tipo "Descarga" o "Entrega".
 * Es exactamente el criterio que ya usaba el POST al crear; el PATCH lo reaplica cuando cambian las paradas.
 */
export type ParadaConLugar = { lugarNombre: string; tipo?: string | null };

export function lugaresDesdeParadas(
  paradas: ParadaConLugar[],
  respaldo: { lugarCarga?: string; lugarDescarga?: string } = {},
): { carga: string | undefined; descarga: string | undefined } {
  const nombre = (p: ParadaConLugar | undefined) => p?.lugarNombre?.trim() || undefined;
  return {
    carga: nombre(paradas.find((p) => p.tipo === "Carga")) || respaldo.lugarCarga,
    descarga: nombre(paradas.find((p) => p.tipo === "Descarga" || p.tipo === "Entrega")) || respaldo.lugarDescarga,
  };
}
