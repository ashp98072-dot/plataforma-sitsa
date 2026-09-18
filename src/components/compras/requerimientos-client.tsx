"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { RequerimientoCompra } from "@/lib/compras/requerimiento-schema";
import { LineasCompraClient, monedaCompra, type LineasCompraConsulta } from "./lineas-compra-client";

const estilo = "rounded border border-[var(--border)] bg-[var(--input)] p-2";
export function RequerimientosClient({ slug, puedeCrear, puedeEditar }: { slug: string; puedeCrear: boolean; puedeEditar: boolean }) {
  const [filas, setFilas] = useState<RequerimientoCompra[]>([]);
  const [filtros, setFiltros] = useState({ codigo: "", desde: "", hasta: "", estado: "" });
  const [consulta, setConsulta] = useState("");
  const [refresco, setRefresco] = useState(0);
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(true);
  const [expandido, setExpandido] = useState<number | null>(null);
  const [cacheLineas] = useState(() => new Map<string, LineasCompraConsulta>());
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/empresas/${slug}/compras/requerimientos?${consulta}`, { cache: "no-store", signal: controller.signal })
      .then(async r => { const data = await r.json(); if (!r.ok) throw new Error(data.error); return data; })
      .then(data => { setFilas(data.requerimientos); setError(""); setCargando(false); })
      .catch(e => { if (!controller.signal.aborted) { setError(e instanceof Error ? e.message : "No se pudo cargar el listado."); setCargando(false); } });
    return () => controller.abort();
  }, [slug, consulta, refresco]);
  const base = `/e/${slug}/compras/requerimientos`;
  return <main className="space-y-5 p-6"><div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-semibold">Requerimientos de compra</h1>
    {puedeCrear && <Link href={`${base}/nuevo`} className={estilo}>+ Nuevo requerimiento</Link>}</div>
    <form className="flex flex-wrap items-end gap-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4" onSubmit={e => { e.preventDefault(); setCargando(true); setExpandido(null); cacheLineas.clear(); setRefresco(v => v + 1); setConsulta(new URLSearchParams(Object.fromEntries(Object.entries(filtros).filter(([, v]) => v))).toString()); }}>
      <label>Código<input className={`${estilo} block`} value={filtros.codigo} maxLength={40} onChange={e => setFiltros({ ...filtros, codigo: e.target.value })} /></label>
      <label>Desde<input className={`${estilo} block`} type="date" value={filtros.desde} onChange={e => setFiltros({ ...filtros, desde: e.target.value })} /></label>
      <label>Hasta<input className={`${estilo} block`} type="date" value={filtros.hasta} onChange={e => setFiltros({ ...filtros, hasta: e.target.value })} /></label>
      <label>Estado<select className={`${estilo} block`} value={filtros.estado} onChange={e => setFiltros({ ...filtros, estado: e.target.value })}><option value="">Todos</option>{["Pendiente", "Autorizada", "Rechazada"].map(v => <option key={v}>{v}</option>)}</select></label><button className={estilo}>Filtrar</button>
    </form>
    {error && <p role="alert">{error}</p>}{cargando && <p role="status">Cargando…</p>}
    <div className="space-y-2">
      {!cargando && !error && !filas.length && <p className="text-[var(--muted)]">No hay requerimientos.</p>}
      {!cargando && !error && filas.map(f => <section key={f.id} aria-label={f.codigo} className="rounded-lg border border-[var(--border)] p-3 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div><span className="font-medium">{f.codigo}</span> · {f.requirente_nombre || "—"} · {f.fecha_requerimiento} · <span className={f.estado === "Rechazada" ? "text-red-400" : f.estado === "Autorizada" ? "text-emerald-400" : "text-amber-400"}>{f.estado}</span> · {monedaCompra(f.total)}
            <p className="mt-1 text-xs text-[var(--muted)]">{f.entidad_requirente_nombre || "Sin dato histórico"} · {f.cantidad_lineas} líneas</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <button type="button" aria-expanded={expandido === f.id} aria-controls={`compra-lineas-${f.id}`} onClick={() => setExpandido(expandido === f.id ? null : f.id)} className="text-[var(--accent)]">{expandido === f.id ? "Ocultar líneas" : "Ver líneas"}</button>
            <Link href={`${base}/${f.id}`} className={estilo}>Ver detalle</Link>
            <a href={`/api/empresas/${slug}/compras/requerimientos/${f.id}/excel`} className={estilo}>Exportar Excel</a>
            <a href={`/api/empresas/${slug}/compras/requerimientos/${f.id}/pdf`} className={estilo}>Descargar PDF</a>
            {puedeEditar && f.estado === "Pendiente" && <Link href={`${base}/${f.id}?editar=1`} className={estilo}>Editar</Link>}
          </div>
        </div>
        {expandido === f.id && <div id={`compra-lineas-${f.id}`} className="mt-3"><LineasCompraClient key={`${slug}/${f.id}`} slug={slug} requerimientoId={f.id} cache={cacheLineas} /></div>}
      </section>)}
    </div></main>;
}
