import { placaComparable } from "./combustible-coincidencias";

/** No deduplicar por placa: dos IDs representan registros independientes hasta revisión humana. */
export function diagnosticarVehiculos<T extends { id: number; placa: string }>(filas: T[]) {
  const porId = new Map<number, T>();
  const repetidos = new Set<number>();
  for (const fila of filas) {
    const id = Number(fila.id);
    if (!Number.isSafeInteger(id) || id <= 0) continue;
    if (porId.has(id)) repetidos.add(id);
    else porId.set(id, { ...fila, id });
  }
  const placas = new Map<string, number[]>();
  for (const v of porId.values()) {
    const placa = placaComparable(v.placa);
    if (placa) placas.set(placa, [...(placas.get(placa) ?? []), v.id]);
  }
  return { vehiculos: [...porId.values()], idsRepetidos: [...repetidos],
    posiblesDuplicados: [...placas].filter(([, ids]) => ids.length > 1).map(([placa, ids]) => ({ placa, ids })) };
}
