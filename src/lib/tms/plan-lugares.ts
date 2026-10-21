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

const esDescarga = (p: ParadaConLugar) => p.tipo === "Descarga" || p.tipo === "Entrega";
const normalizar = (t: string) => t.trim().replace(/\s+/g, " ").toLowerCase();

/** Texto de la PRIMERA parada Descarga/Entrega (la misma que fija lugar_descarga_id); undefined si no hay. */
export function descargaDeParadas(paradas: ParadaConLugar[]): string | undefined {
  return paradas.find((p) => esDescarga(p) && p.lugarNombre?.trim())?.lugarNombre.trim();
}

/** Igualdad tolerante (mayúsculas/espacios) entre la descripción guardada y el texto de una parada. */
export function mismaDescripcion(a: string | null | undefined, b: string | null | undefined): boolean {
  return normalizar(a ?? "") === normalizar(b ?? "");
}

/**
 * ¿Hay una descripción de reporte DISTINTA de la primera descarga? (formulario y servidor usan la misma regla).
 * Una descripción igual a la parada, o vacía, NO es una "descripción distinta": se deriva sola de las paradas.
 */
export function descripcionReporteDistinta(historico: string | null | undefined, paradas: ParadaConLugar[]): boolean {
  const h = (historico ?? "").trim();
  return h !== "" && !mismaDescripcion(h, descargaDeParadas(paradas));
}

/**
 * PROGRAMACION-PARADAS-FUENTE — valor de tms_planes_viaje.lugar_descarga_historico ("Lugar de Descarga" del reporte
 * tradicional, imagen, viáticos y gastos). Las PARADAS son la fuente: el servidor lo deriva de la primera
 * Descarga/Entrega y el usuario no lo captura dos veces. Única excepción (VIAT-4b: la columna del reporte es una
 * descripción operativa de texto libre, p. ej. «RUTA-X - punto1-punto2-punto3», que puede diferir de la parada):
 * una "descripción distinta" explícita o ya guardada se CONSERVA. Contrato de `override` (payload
 * lugarDescargaHistorico): undefined/"" = no manda nada; null = quitar la descripción distinta (volver a seguir las
 * paradas); texto = descripción distinta para este viaje.
 *
 * `aplicar:false` = no tocar la columna (PATCH que no cambia el destino). `actual` solo existe al editar un viaje.
 */
export function resolverDescargaReporte(i: {
  override: string | null | undefined;
  paradasNuevas: ParadaConLugar[] | undefined;
  actual?: { historico: string | null | undefined; paradas: ParadaConLugar[] };
  respaldoLegacy?: string;
}): { aplicar: boolean; valor: string | null } {
  const derivada = descargaDeParadas(i.paradasNuevas ?? i.actual?.paradas ?? []) || i.respaldoLegacy?.trim() || null;
  const texto = typeof i.override === "string" ? i.override.trim() : i.override;
  if (typeof texto === "string" && texto !== "") return { aplicar: true, valor: texto };
  if (texto === null) return { aplicar: true, valor: derivada };
  // Sin instrucción explícita.
  if (!i.actual) return { aplicar: true, valor: derivada }; // creación
  if (i.paradasNuevas === undefined) return { aplicar: false, valor: null }; // el destino no cambia
  const sigueAParadas = !(i.actual.historico ?? "").trim() || mismaDescripcion(i.actual.historico, descargaDeParadas(i.actual.paradas));
  return sigueAParadas ? { aplicar: true, valor: derivada } : { aplicar: false, valor: null };
}
