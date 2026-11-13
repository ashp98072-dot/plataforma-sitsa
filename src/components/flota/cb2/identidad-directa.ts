import { nombreComparable, identificarPlaca } from "@/lib/flota/combustible-coincidencias";
import type { CatalogosCB2, FilaCB2 } from "./client";
import type { DecisionAsignacion } from "./asignacion";
import { proponerTerceroDirecto } from "@/lib/flota/cb2/identidad-directa";
export function propuestaDirecta(f: FilaCB2, cat: CatalogosCB2) {
  if (!cat.tercerosDirectos || !cat.tercerosHabilitados) return null;
  if (identificarPlaca(f.placaNormalizada || f.placa, cat.vehiculos, v => v.placa).candidatos.length !== 1) return null;
  return proponerTerceroDirecto(f.origen?.piloto ?? "", f.placaNormalizada || f.placa, cat.pilotosExternos ?? [], cat.unidadesExternas ?? []);
}
export function pilotoDirecto(f: FilaCB2, cat: CatalogosCB2, d: DecisionAsignacion = {}) {
  const pilotos = cat.pilotosExternos ?? [];
  if (d.pilotoExternoId !== undefined) return pilotos.find(p => p.id === d.pilotoExternoId);
  const candidatos = pilotos.filter(p => nombreComparable(p.nombre) === nombreComparable(f.origen?.piloto ?? ""));
  return candidatos.length === 1 ? candidatos[0] : undefined;
}
