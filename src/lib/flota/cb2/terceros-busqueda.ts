import { normalizarTextoBusqueda } from "@/lib/busqueda-personas";
import { identificarPlaca } from "../combustible-coincidencias";

/** Solo búsqueda: conserva los valores originales y nunca deduce identidad. */
export const normalizarBusquedaUnidad = (s: string) => normalizarTextoBusqueda(s).replace(/[\s‐‑–—-]/g, "");
export function unidadTerceraCompatible(placa: string, id: number, unidades: { id: number; placa: string }[], motivo = "") {
  const candidatas = identificarPlaca(placa, unidades, u => u.placa).candidatos;
  return candidatas.some(u => u.id === id) && (candidatas.length === 1 || motivo.trim().length >= 10);
}
