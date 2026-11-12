import { nombreComparable } from "@/lib/flota/combustible-coincidencias";
import type { CatalogosCB2, FilaCB2 } from "./client";
import type { DecisionAsignacion } from "./asignacion";
export function pilotoDirecto(f: FilaCB2, cat: CatalogosCB2, d: DecisionAsignacion = {}) {
  const pilotos = cat.pilotosExternos ?? [];
  if (d.pilotoExternoId !== undefined) return pilotos.find(p => p.id === d.pilotoExternoId);
  const candidatos = pilotos.filter(p => nombreComparable(p.nombre) === nombreComparable(f.origen?.piloto ?? ""));
  return candidatos.length === 1 ? candidatos[0] : undefined;
}
