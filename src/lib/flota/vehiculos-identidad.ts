import { catalogoSinAlias } from "./vehiculos-alias";

/**
 * Colapso por IDENTIDAD FÍSICA APROBADA en las pantallas de Flota. Interruptor de emergencia: `FLOTA_IDENTIDAD_COLAPSO_UI=0` (activo por defecto; sin identidades aprobadas no cambia nada).
 * NO oculta nada por compartir placa: solo las fichas unidas por una identidad aprobada. La lista que devuelve la API sigue completa (para resolver históricos);
 * cada ficha lleva `esRepresentante` y, si no lo es, `vinculadaA` (ID de la representante), para que la pantalla muestre UNA unidad y permita «ver todas».
 */
export const colapsoPorIdentidadActivo = (env: NodeJS.ProcessEnv = process.env) => env.FLOTA_IDENTIDAD_COLAPSO_UI !== "0";

export type AnotacionIdentidad = { esRepresentante: boolean; identidadFisicaId: number | null; vinculadaA: number | null; fichasVinculadas: number[] };

type Base = { id: number; empresa_id?: unknown; descripcion?: unknown };

/** Anota cada ficha con su situación de identidad desde la empresa que consulta (la representante es la propia ficha activa de menor ID, si no, la de menor ID). */
export async function anotarIdentidades<T extends Base>(vehiculos: T[], empresaId: number, representantes?: { id: number; identidadFisicaId?: number; equivalenciasHistoricas?: number[] }[]): Promise<(T & AnotacionIdentidad)[]> {
  const reps = representantes ?? await catalogoSinAlias(vehiculos, empresaId);
  const repIds = new Set(reps.map(r => Number(r.id)));
  const porMiembro = new Map<number, { repId: number; identidad: number | null; todas: number[] }>();
  for (const r of reps) {
    const todas = (r.equivalenciasHistoricas ?? []).map(Number).sort((x, y) => x - y);
    for (const m of todas) porMiembro.set(m, { repId: Number(r.id), identidad: r.identidadFisicaId ?? null, todas });
  }
  return vehiculos.map(v => {
    const id = Number(v.id), enGrupo = porMiembro.get(id);
    const esRepresentante = repIds.has(id) || !enGrupo;
    return { ...v, esRepresentante, identidadFisicaId: enGrupo?.identidad ?? null, vinculadaA: esRepresentante ? null : enGrupo?.repId ?? null, fichasVinculadas: enGrupo ? enGrupo.todas.filter(x => x !== id) : [] };
  });
}
