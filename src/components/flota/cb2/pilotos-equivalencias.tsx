"use client";
import { useCallback, useState } from "react";
import { CatalogoSearchSelect } from "@/components/tms/catalogo-search-select";
import { etiquetaEmpleado } from "@/lib/flota/cb2/empleados-baja";
import type { EquivalenciaPiloto } from "@/lib/flota/cb2/pilotos-equivalencias";
import { jsonCB2, type CatalogosCB2 } from "./client";
import { button, input } from "./controles";

/**
 * Pilotos reconocidos automáticamente (Shell y HALEL): empleado de RR. HH. o piloto reportado guardado. Permite corregir un reconocimiento equivocado: quitarlo (la próxima importación
 * vuelve a preguntar) o reasignarlo a un empleado. Solo cambia importaciones FUTURAS: los consumos ya importados no se modifican. Escribir requiere Admin (el servidor lo exige).
 */
export function PilotosEquivalenciasCB2({ api, cat, puedeCorregir }: { api: string; cat: CatalogosCB2; puedeCorregir: boolean }) {
  const [datos, setDatos] = useState<{ instalado: boolean; items: EquivalenciaPiloto[] } | null>(null), [error, setError] = useState(""), [mensaje, setMensaje] = useState(""), [busy, setBusy] = useState(false);
  const [reasignar, setReasignar] = useState<Record<string, string>>({});
  const cargar = useCallback(async () => { try { setError(""); setDatos(await jsonCB2<{ instalado: boolean; items: EquivalenciaPiloto[] }>(`${api}/pilotos-equivalencias`)); } catch (e) { setError(e instanceof Error ? e.message : "No se pudieron cargar los reconocimientos."); } }, [api]);
  async function corregir(cuerpo: Record<string, unknown>, ok: string) {
    if (busy) return; setBusy(true); setMensaje(""); setError("");
    try { await jsonCB2(`${api}/pilotos-equivalencias`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) }); setMensaje(ok); await cargar(); }
    catch (e) { setError(e instanceof Error ? e.message : "No se pudo corregir."); } finally { setBusy(false); }
  }
  if (!datos) return <section aria-label="Pilotos reconocidos automáticamente" className="space-y-2"><button type="button" className={button} onClick={() => void cargar()}>Ver pilotos reconocidos automáticamente</button>{error && <p role="alert">{error}</p>}</section>;
  if (!datos.instalado) return <p role="status">El registro de pilotos reportados no está instalado.</p>;
  return <section aria-label="Pilotos reconocidos automáticamente" className="space-y-2 rounded-xl border border-[var(--border)] p-3">
    <h3 className="font-semibold">Pilotos reconocidos automáticamente</h3>
    <p className="text-xs">Nombres que las importaciones Shell y HALEL reconocen solos. Corregir un reconocimiento solo afecta importaciones futuras: los consumos ya importados no cambian.</p>
    {error && <p role="alert">{error}</p>}{mensaje && <p role="status">{mensaje}</p>}
    {!datos.items.length ? <p className="text-xs">Todavía no hay pilotos guardados.</p> : <ul className="space-y-2">{datos.items.map(e => <li key={e.nombreHash} className="space-y-1 border-t border-[var(--border)] pt-2">
      <p><strong>{e.nombre}</strong> → {e.tipo === "EMPLEADO" ? `Empleado ${e.empleadoNombre ?? `#${e.empleadoId}`}` : `Piloto externo (reportado${e.reportadoNombre ? `: ${e.reportadoNombre}` : ""})`}{e.tipo === "REPORTADO" ? ` · ${e.consumos} consumos` : ""}{e.requiereRevision ? " · requiere revisión" : ""}</p>
      {puedeCorregir && <div className="flex flex-wrap items-end gap-2">
        <button type="button" className={button} disabled={busy} onClick={() => void corregir({ accion: "QUITAR", nombreHash: e.nombreHash }, `Se quitó el reconocimiento de ${e.nombre}.`)}>Quitar reconocimiento de {e.nombre}</button>
        <CatalogoSearchSelect label={`Reasignar ${e.nombre} a un empleado`} placeholder="Buscar empleado" inputClassName={input} value={reasignar[e.nombreHash] ?? ""} options={(cat.empleados ?? []).map(p => ({ value: String(p.id), label: etiquetaEmpleado(p) }))} onChange={v => setReasignar(prev => ({ ...prev, [e.nombreHash]: v }))}/>
        <button type="button" className={button} disabled={busy || !reasignar[e.nombreHash]} onClick={() => void corregir({ accion: "EMPLEADO", nombreHash: e.nombreHash, empleadoId: Number(reasignar[e.nombreHash]) }, `${e.nombre} quedó asignado al empleado elegido.`)}>Reasignar {e.nombre}</button>
      </div>}
    </li>)}</ul>}
  </section>;
}
