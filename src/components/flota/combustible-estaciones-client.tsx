"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Estacion } from "@/lib/flota/combustible-estaciones";
const input = "rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1.5";
export function CombustibleEstacionesClient({ slug, puedeEditar }: { slug: string; puedeEditar: boolean }) {
  const [items, setItems] = useState<Estacion[]>([]);
  const [proveedores, setProveedores] = useState<{ id: number; nombre: string }[]>([]);
  const [buscar, setBuscar] = useState(""); const [proveedor, setProveedor] = useState(""); const [activo, setActivo] = useState("todos");
  const [edicion, setEdicion] = useState<Estacion | "nueva" | null>(null);
  const [error, setError] = useState(""); const [cargando, setCargando] = useState(false); const [guardando, setGuardando] = useState(false);
  const vuelo = useRef(false);
  const base = `/api/empresas/${slug}/flota/combustible`;
  const cargar = useCallback(async (signal?: AbortSignal) => {
    setCargando(true);
    try {
      const params = new URLSearchParams({ buscar, proveedorId: proveedor, activo });
      const res = await fetch(`${base}/estaciones?${params}`, { signal }); const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo cargar estaciones.");
      if (!signal?.aborted) { setItems(data.items); setError(""); }
    } catch (e) { if (!signal?.aborted) setError(e instanceof Error ? e.message : "Error al cargar."); }
    finally { if (!signal?.aborted) setCargando(false); }
  }, [base, buscar, proveedor, activo]);
  useEffect(() => {
    const ac = new AbortController(); const timer = setTimeout(() => void cargar(ac.signal), 200);
    return () => { clearTimeout(timer); ac.abort(); };
  }, [cargar]);
  useEffect(() => {
    const ac = new AbortController();
    fetch(`${base}/catalogos`, { signal: ac.signal }).then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error); setProveedores(d.proveedores); }).catch(e => { if (!ac.signal.aborted) setError(e.message); });
    return () => ac.abort();
  }, [base]);
  const guardar = async (body: object, id?: number) => {
    if (vuelo.current) return false;
    vuelo.current = true; setGuardando(true); setError("");
    try {
      const res = await fetch(`${base}/estaciones${id ? `/${id}` : ""}`, { method: id ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await res.json(); if (!res.ok) throw new Error(d.error ?? "No se pudo guardar.");
      await cargar(); return true;
    } catch (e) { setError(e instanceof Error ? e.message : "Error al guardar."); return false; }
    finally { vuelo.current = false; setGuardando(false); }
  };
  const actual = edicion && edicion !== "nueva" ? edicion : null;
  return <section className="space-y-4 p-4"><h1 className="text-xl font-semibold">Estaciones de combustible</h1>
    <Link href={`/e/${slug}/combustibles`} prefetch={false}>Volver a Combustibles</Link>
    {error && <p role="alert" className="text-red-500">{error}</p>}
    <div className="flex flex-wrap gap-2"><input aria-label="Buscar estación" className={input} placeholder="Buscar estación..." value={buscar} onChange={e => setBuscar(e.target.value)} />
      <select aria-label="Filtrar proveedor" className={input} value={proveedor} onChange={e => setProveedor(e.target.value)}><option value="">Todos los proveedores</option>{proveedores.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select>
      <select aria-label="Estado" className={input} value={activo} onChange={e => setActivo(e.target.value)}><option value="todos">Todas</option><option value="1">Activas</option><option value="0">Inactivas</option></select>
      {puedeEditar && <button className={input} onClick={() => setEdicion("nueva")}>Nueva estación</button>}
    </div>
    {edicion && puedeEditar && <form key={actual?.id ?? "nueva"} className="flex flex-wrap items-end gap-3 rounded border border-[var(--border)] p-4" onSubmit={async e => {
      e.preventDefault(); const f = new FormData(e.currentTarget);
      if (await guardar({ proveedorId: Number(f.get("proveedorId")), nombre: String(f.get("nombre")), direccion: String(f.get("direccion")) }, actual?.id)) setEdicion(null);
    }}><label>Proveedor<select name="proveedorId" required className={`${input} block`} defaultValue={actual?.proveedorId ?? ""}><option value="">Seleccionar proveedor</option>
      {actual && !proveedores.some(p => p.id === actual.proveedorId) && <option value={actual.proveedorId}>{actual.proveedorNombre} · Histórico</option>}
      {proveedores.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select></label>
      <label>Estación<input name="nombre" required maxLength={150} className={`${input} block`} defaultValue={actual?.nombre ?? ""} /></label>
      <label>Dirección / referencia<input name="direccion" maxLength={500} className={`${input} block`} defaultValue={actual?.direccion ?? ""} /></label>
      <button disabled={guardando} className={input}>{guardando ? "Guardando…" : "Guardar"}</button><button type="button" disabled={guardando} onClick={() => setEdicion(null)}>Cancelar</button>
    </form>}
    <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{["Proveedor", "Estación", "Dirección / referencia", "Estado", "Acciones"].map(t => <th className="p-2" key={t}>{t}</th>)}</tr></thead>
      <tbody>{items.map(e => <tr key={e.id} className="border-t border-[var(--border)]"><td className="p-2">{e.proveedorNombre}</td><td className="p-2">{e.nombre}</td><td className="p-2">{e.direccion ?? "—"}</td><td className="p-2">{e.activo ? "Activa" : "Inactiva"}</td><td className="p-2">{puedeEditar && <><button disabled={guardando} onClick={() => setEdicion(e)}>Editar</button>{" / "}<button disabled={guardando} onClick={() => void guardar({ activo: !e.activo }, e.id)}>{e.activo ? "Desactivar" : "Reactivar"}</button></>}</td></tr>)}</tbody>
    </table>{cargando ? <p>Cargando…</p> : items.length === 0 && <p>No hay estaciones con estos filtros.</p>}</div>
  </section>;
}
