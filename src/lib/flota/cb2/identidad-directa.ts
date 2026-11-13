import { identificarPlaca, nombreComparable, placaComparable } from "../combustible-coincidencias";
import type { PilotoTercero, UnidadTercera } from "./terceros-model";

export function tipoTerceroCompatible(placa: string, unidad: UnidadTercera) {
  if (!["VEHICULO", "MOTOCICLETA"].includes(unidad.tipo)) return false;
  const completa = placaComparable(unidad.placa);
  const original = placaComparable(placa);
  if (/^M\d{3}[A-Z]{3}$/.test(completa) && unidad.tipo !== "MOTOCICLETA") return false;
  if (/^[A-LN-Z]\d{3}[A-Z]{3}$/.test(completa) && unidad.tipo !== "VEHICULO") return false;
  return !!original;
}

/** Catalogues must already be scoped by the authenticated company. No fuzzy names or plate guesses. */
export function proponerTerceroDirecto(nombre: string, placa: string, pilotos: PilotoTercero[], unidades: UnidadTercera[]) {
  const n = nombreComparable(nombre);
  const personas = n ? pilotos.filter(p => nombreComparable(p.nombre) === n) : [];
  const candidatas = identificarPlaca(placa, unidades, u => u.placa).candidatos;
  if (personas.length !== 1 || candidatas.length !== 1 || !tipoTerceroCompatible(placa, candidatas[0])) return null;
  return { piloto: personas[0], unidad: candidatas[0] };
}
