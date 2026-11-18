"use client";
import type { resumenPrevio } from "./resumen-previo";

/** Resumen visible antes de confirmar. Filas = filas del Excel; las cinco primeras categorías suman el total. */
export function ResumenPrevioCB2({ r }: { r: ReturnType<typeof resumenPrevio> }) {
  const celdas: [string, number][] = [["Filas del archivo", r.total], ["Válidas", r.validas], ["Listas para importar", r.listas], ["Pendientes", r.pendientes], ["Bloqueadas", r.bloqueadas], ["Ya importadas", r.yaImportadas], ["Ignoradas", r.ignoradas]];
  const m = r.motivos;
  return <section aria-label="Resumen antes de confirmar" className="space-y-2 rounded-xl border border-[var(--border)] p-3">
    <h4 className="font-semibold">Resumen antes de confirmar</h4>
    <dl className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7">{celdas.map(([t, n]) => <div key={t} className="rounded-lg border border-[var(--border)] p-2"><dt className="text-xs">{t}</dt><dd className="text-lg font-semibold">{n}</dd></div>)}</dl>
    <p className="text-xs">Listas + pendientes = válidas ({r.listas} + {r.pendientes} = {r.validas}). Válidas + bloqueadas + ya importadas + ignoradas = {r.total} filas{r.cuadra ? "" : " (NO CUADRA: no confirmes y reporta el caso)"}.</p>
    <p className="text-xs" role="status">Motivos de las {r.pendientes} filas pendientes (pueden solaparse): sin decisión de piloto {m.piloto} · sin unidad {m.unidad} · placa ambigua {m.ambiguas} · unidad no operable {m.unidadNoOperable} · sin clasificar combustible {m.combustible} · excluidas por ti {m.excluidasPorUsuario}.</p>
    {r.detalleNoOperables.map(t => <p key={t} role="alert" className="text-xs">{t}</p>)}
    <p className="text-xs">Al confirmar solo se guardan las filas listas. Las pendientes y bloqueadas no se pierden: el Excel original queda guardado y las retomas después en Historial → «Reanudar candidatos pendientes», sin duplicar lo ya importado.</p>
  </section>;
}
