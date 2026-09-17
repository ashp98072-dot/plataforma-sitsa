"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { RequerimientoCompra } from "@/lib/compras/requerimiento-schema";

const estilo = "rounded border border-[var(--border)] bg-[var(--input)] p-2";
export function RequerimientosClient({ slug, puedeCrear, puedeEditar }: { slug: string; puedeCrear: boolean; puedeEditar: boolean }) {
  const [filas, setFilas] = useState<RequerimientoCompra[]>([]);
  const [filtros, setFiltros] = useState({ codigo: "", desde: "", hasta: "", estado: "" });
  const [consulta, setConsulta] = useState("");
  const [refresco, setRefresco] = useState(0);
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(true);
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
    <form className="flex flex-wrap items-end gap-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4" onSubmit={e => { e.preventDefault(); setCargando(true); setRefresco(v => v + 1); setConsulta(new URLSearchParams(Object.fromEntries(Object.entries(filtros).filter(([, v]) => v))).toString()); }}>
      <label>Código<input className={`${estilo} block`} value={filtros.codigo} maxLength={40} onChange={e => setFiltros({ ...filtros, codigo: e.target.value })} /></label>
      <label>Desde<input className={`${estilo} block`} type="date" value={filtros.desde} onChange={e => setFiltros({ ...filtros, desde: e.target.value })} /></label>
      <label>Hasta<input className={`${estilo} block`} type="date" value={filtros.hasta} onChange={e => setFiltros({ ...filtros, hasta: e.target.value })} /></label>
      <label>Estado<select className={`${estilo} block`} value={filtros.estado} onChange={e => setFiltros({ ...filtros, estado: e.target.value })}><option value="">Todos</option>{["Pendiente", "Autorizada", "Rechazada"].map(v => <option key={v}>{v}</option>)}</select></label><button className={estilo}>Filtrar</button>
    </form>
    {error && <p role="alert">{error}</p>}{cargando && <p role="status">Cargando…</p>}
    <div className="overflow-x-auto rounded-xl border border-[var(--border)]"><table className="w-full text-left text-sm"><thead><tr>{["Código", "Fecha", "Empresa requirente", "Persona que requiere", "Líneas", "Total", "Estado", "Acciones"].map(v => <th key={v} className="p-3">{v}</th>)}</tr></thead><tbody>
      {!cargando && !error && !filas.length && <tr><td colSpan={8} className="p-4">No hay requerimientos.</td></tr>}
      {filas.map(f => <tr key={f.id} className="border-t border-[var(--border)]"><td className="p-3">{f.codigo}</td><td className="p-3">{f.fecha_requerimiento}</td><td className="p-3">{f.entidad_requirente_nombre || "Sin dato histórico"}</td><td className="p-3">{f.requirente_nombre || "—"}</td><td className="p-3">{f.cantidad_lineas}</td><td className="whitespace-nowrap p-3">Q {Number(f.total).toFixed(2)}</td><td className="p-3">{f.estado}</td><td className="space-x-3 whitespace-nowrap p-3"><Link href={`${base}/${f.id}`}>Ver</Link>{puedeEditar && f.estado === "Pendiente" && <Link href={`${base}/${f.id}?editar=1`}>Editar</Link>}</td></tr>)}
    </tbody></table></div><Link href={`/e/${slug}/compras`}>Volver a Compras / Repuestos</Link></main>;
}
