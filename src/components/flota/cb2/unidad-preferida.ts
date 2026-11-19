import { placaComparable } from "@/lib/flota/combustible-coincidencias";
import { procedenciaFicha } from "@/lib/flota/combustible-estaciones-ui";
import type { CatalogosCB2 } from "./client";
import { sugerenciaVehiculo, type CandidatoRevision } from "./preview-model";

type Ficha = CatalogosCB2["vehiculos"][number];

/**
 * Ficha preferida para una placa REPETIDA dentro de un archivo de Shell.
 *
 * Reglas (no negociables):
 * - Dos fichas con la misma placa NO son por eso la misma unidad física: nunca se ocultan ni se eligen solas.
 * - Con identidad física APROBADA el catálogo ya trae una sola ficha (catalogoSinAlias) y aquí no hay nada que advertir.
 * - Sin identidad aprobada, la persona elige explícitamente una ficha y puede aplicarla a las demás filas AMBIGUAS del mismo archivo con la misma placa.
 *   Solo alcanza filas que sigan sin unidad, no bloqueadas ni resueltas, y cuya sugerencia sea AMBIGUA; nunca pisa una elección manual previa.
 */
const comparable = (p: string) => placaComparable(p || "");

/** Fichas del catálogo (no externas) con la misma placa comparable. */
export const fichasMismaPlaca = (cat: CatalogosCB2, placa: string): Ficha[] => {
  const clave = comparable(placa);
  return clave ? cat.vehiculos.filter(v => v.id > 0 && comparable(v.placa) === clave) : [];
};

/** Texto de advertencia para una placa con varias fichas y sin identidad física aprobada; null si no aplica. */
export function advertenciaPlacaRepetida(cat: CatalogosCB2, placa: string): string | null {
  const fichas = fichasMismaPlaca(cat, placa);
  if (fichas.length < 2) return null;
  const aprobadas = new Set(fichas.map(f => f.identidadFisicaId ?? 0));
  if (aprobadas.size === 1 && !aprobadas.has(0)) return null; // misma identidad física aprobada
  const detalle = fichas.map(f => `#${f.id} (${procedenciaFicha(f) || "sin datos de procedencia"})`).join(" · ");
  return `La placa ${fichas[0].placa} tiene ${fichas.length} fichas sin identidad física aprobada: ${detalle}. Pueden ser unidades distintas; elige la ficha explícitamente. Para unirlas, aprueba su identidad física en Identidades físicas.`;
}

/** Claves de las OTRAS filas del archivo a las que se puede aplicar la ficha elegida para `g` (misma placa, ambiguas y pendientes). */
export function filasAmbiguasMismaPlaca(revision: CandidatoRevision[], cat: CatalogosCB2, g: CandidatoRevision, vehiculoId: string): string[] {
  const elegida = cat.vehiculos.find(v => String(v.id) === vehiculoId && v.id > 0);
  if (!elegida) return [];
  const clave = comparable(elegida.placa);
  return revision.filter(h => h.clave !== g.clave && !h.vehiculoId && h.estado !== "BLOQUEADO" && h.estado !== "RESUELTO"
    && comparable(h.fila.placaNormalizada || h.fila.placa) === clave && sugerenciaVehiculo(h.fila, cat).estado === "AMBIGUA").map(h => h.clave);
}
