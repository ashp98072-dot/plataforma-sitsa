import { clasificarProducto } from "@/lib/flota/cb2/clasificacion";
import { identificarPlaca } from "@/lib/flota/combustible-coincidencias";
import type { CatalogosCB2, FilaCB2 } from "./client";
import type { DecisionAsignacion } from "./asignacion";
import { motivoUnidadNoOperable } from "./unidades-bloqueo";

type Entrada = { filas: FilaCB2[]; cat: CatalogosCB2; segura: Record<string, string>; omitidos: Record<string, boolean>; decisiones: Record<string, DecisionAsignacion> };
const activa = (f: FilaCB2) => !!f.candidato && !f.bloqueada && !["IGNORADA", "RESUELTA"].includes(f.estado);
const nombreResuelto = (f: FilaCB2, d: DecisionAsignacion | undefined) => f.perfil !== "SHELL" || d?.pilotoTipo === "EXTERNO" || !!d?.decisionNombre;
const productoResuelto = (f: FilaCB2, d: DecisionAsignacion | undefined) => !!(d?.productoClasificado ?? clasificarProducto(f.origen?.producto));

/** Candidatos que se pueden importar HOY: unidad válida y operable, no excluidos, nombre decidido y combustible clasificado.
 * Todo lo demás se conserva como pendiente; nunca se descarta ni se importa a medias. */
export function clavesListas({ filas, segura, omitidos, decisiones }: Entrada): Set<string> {
  const listas = new Set<string>();
  for (const f of filas) {
    const k = f.candidato;
    if (!k || !segura[k] || omitidos[k] || !activa(f)) continue;
    const todas = filas.filter(x => x.candidato === k && x.estado !== "RESUELTA" && x.estado !== "IGNORADA");
    if (todas.every(x => activa(x) && nombreResuelto(x, decisiones[k]) && productoResuelto(x, decisiones[k]))) listas.add(k);
  }
  return listas;
}

/** Resumen por FILA del Excel antes de confirmar. Las primeras cinco categorías son excluyentes y suman el total;
 * las de «motivos» son indicadores que pueden solaparse entre las pendientes. */
export function resumenPrevio(e: Entrada) {
  const { filas, cat, segura, omitidos, decisiones } = e, listas = clavesListas(e);
  const r = { total: filas.length, ignoradas: 0, yaImportadas: 0, bloqueadas: 0, listas: 0, pendientes: 0, validas: 0,
    motivos: { piloto: 0, unidad: 0, ambiguas: 0, unidadNoOperable: 0, combustible: 0, excluidasPorUsuario: 0 },
    detalleNoOperables: [] as string[], cuadra: false };
  const noOperables = new Set<string>();
  for (const f of filas) {
    if (f.estado === "IGNORADA") { r.ignoradas++; continue; }
    if (f.estado === "RESUELTA") { r.yaImportadas++; continue; }
    if (!f.candidato || f.bloqueada) { r.bloqueadas++; continue; }
    const k = f.candidato, d = decisiones[k];
    if (listas.has(k)) { r.listas++; continue; }
    r.pendientes++;
    const placa = identificarPlaca(f.placaNormalizada || f.placa, cat.vehiculos, v => v.placa), bloqueo = placa.candidatos.map(motivoUnidadNoOperable).find(Boolean);
    if (!nombreResuelto(f, d)) r.motivos.piloto++;
    if (omitidos[k]) r.motivos.excluidasPorUsuario++;
    if (!segura[k] && !omitidos[k]) r.motivos.unidad++;
    if (placa.estado === "AMBIGUA") r.motivos.ambiguas++;
    if (bloqueo) { r.motivos.unidadNoOperable++; noOperables.add(bloqueo); }
    if (!productoResuelto(f, d)) r.motivos.combustible++;
  }
  r.validas = r.listas + r.pendientes; r.detalleNoOperables = [...noOperables];
  r.cuadra = r.ignoradas + r.yaImportadas + r.bloqueadas + r.listas + r.pendientes === r.total;
  return r;
}
