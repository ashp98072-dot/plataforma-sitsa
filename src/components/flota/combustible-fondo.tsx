"use client";
import { useEffect, useState } from "react";
import type { LineaFondoCombustible } from "@/lib/flota/combustible-fondos";
import { CatalogoSearchSelect } from "@/components/tms/catalogo-search-select";

export function ContextoFondo({ fondo }: { fondo: LineaFondoCombustible }) {
  return <div className="text-xs"><p>{fondo.codigo} · {fondo.categoria} · {fondo.estado} · Monto línea Q{fondo.montoSolicitado}</p>
    <p>Unidad: {fondo.vehiculoId == null ? "Sin unidad: no validada por Solicitud de Fondos" : fondo.placa ?? "Unidad vinculada, sin placa histórica"} · Empleado relacionado: {fondo.empleadoRelacionado ?? "Sin dato"}</p></div>;
}
export function FondoCombustibleSelector({ slug, value, onChange, historico }: { slug: string; value: string; onChange: (value: string) => void; historico?: LineaFondoCombustible | null }) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<LineaFondoCombustible[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    const ac = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/empresas/${slug}/flota/combustible/fondos?q=${encodeURIComponent(q)}`, { signal: ac.signal }).then(async res => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "No se pudieron cargar las líneas.");
        if (!ac.signal.aborted) { setItems(json.items); setError(""); }
      }).catch(e => { if (!ac.signal.aborted) setError(e.message); });
    }, 250);
    return () => { clearTimeout(timer); ac.abort(); };
  }, [slug, q]);
  const options = historico && !items.some(l => l.id === historico.id) ? [historico, ...items] : items;
  const seleccion = options.find(l => String(l.id) === value);
  return <fieldset className="space-y-2 rounded border border-[var(--border)] p-3"><legend>Solicitud de fondo / combustible (opcional)</legend>
    <input type="hidden" name="solicitudFondoLineaId" value={value} />
    <CatalogoSearchSelect label="Línea de combustible" placeholder="Buscar solicitud, placa o empleado..." value={value} onChange={onChange} onSearchChange={setQ}
      inputClassName="w-full rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1.5"
      emptyLabel="Sin solicitud de fondo" options={options.map(l => ({ value: String(l.id), label: `${l.codigo} · Combustible · ${l.placa ?? "Sin unidad"} · ${l.empleadoRelacionado ?? "Sin empleado"} · Q${l.montoSolicitado}` }))} />
    <small>Hasta 50 coincidencias. Solo Autorizada/Liquidada; un vínculo histórico no elegible debe quitarse o cambiarse antes de guardar.</small>
    {seleccion && <ContextoFondo fondo={seleccion} />}{error && <p role="alert">{error}</p>}
  </fieldset>;
}
export function ResumenLineaFondo({ slug, lineaId }: { slug: string; lineaId: number }) {
  const [fondo, setFondo] = useState<LineaFondoCombustible | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const ac = new AbortController();
    fetch(`/api/empresas/${slug}/flota/combustible/fondos?lineaId=${lineaId}`, { signal: ac.signal }).then(async res => {
      const json = await res.json(); if (!res.ok) throw new Error(json.error ?? "No se pudo cargar el resumen.");
      if (!ac.signal.aborted) setFondo(json.items[0] ?? null);
    }).catch(e => { if (!ac.signal.aborted) setError(e.message); });
    return () => ac.abort();
  }, [slug, lineaId]);
  return <div>{error && <p role="alert">{error}</p>}{fondo && <><ContextoFondo fondo={fondo} /><p>Vales: {fondo.vales} · Pendientes Q{fondo.pendiente} · Aprobados Q{fondo.aprobado} · Rechazados Q{fondo.rechazado}</p></>}</div>;
}
