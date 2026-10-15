"use client";
import { useEffect, useRef, useState } from "react";
import { precioCalculado } from "@/lib/flota/combustible-staff-schema";
import { estacionesDelProveedor, estacionAlCambiarProveedor, type EstacionOpcion } from "@/lib/flota/combustible-estaciones-ui";

export type ValeEditable = {
  id: number; vehiculoId?: number; proveedorId?: number | null; viajeId: number | null;
  numeroVale: string | null; fechaConsumo: string | null; tipoCombustible: string;
  galones: number; monto: number; km: number | null; gasolinera: string | null;
  observaciones?: string | null; placa: string;
  estacionId?: number | null;
};
type Catalogos = { proveedores: { id: number; nombre: string }[]; vehiculos: { id: number; placa: string; descripcion?: string }[]; estaciones: EstacionOpcion[] };
const input = "w-full rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1.5";
export function CombustibleRegistro({ slug, vale, onSaved, onCancel }: { slug: string; vale?: ValeEditable; onSaved: () => void; onCancel: () => void }) {
  const [catalogos, setCatalogos] = useState<Catalogos>({ proveedores: [], vehiculos: [], estaciones: [] });
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [galones, setGalones] = useState(String(vale?.galones ?? ""));
  const [monto, setMonto] = useState(String(vale?.monto ?? ""));
  const [proveedorId, setProveedorId] = useState(String(vale?.proveedorId ?? ""));
  const [vehiculoId, setVehiculoId] = useState(String(vale?.vehiculoId ?? ""));
  const [estacionId, setEstacionId] = useState(String(vale?.estacionId ?? ""));
  const estaciones = estacionesDelProveedor(catalogos.estaciones, proveedorId);
  const enCurso = useRef(false);
  useEffect(() => {
    const ac = new AbortController();
    fetch(`/api/empresas/${slug}/flota/combustible/catalogos`, { signal: ac.signal }).then(async res => {
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "No se pudieron cargar los catálogos.");
      setCatalogos(json);
    }).catch(e => { if (!ac.signal.aborted) setError(e.message); });
    return () => ac.abort();
  }, [slug]);
  let precio = "—";
  try { if (Number(galones) > 0 && Number(monto) > 0) precio = precioCalculado(monto, galones); } catch { /* incompleto */ }
  return <form className="space-y-3 rounded border border-[var(--border)] p-4" onSubmit={async e => {
    e.preventDefault();
    if (enCurso.current) return;
    enCurso.current = true; setGuardando(true); setError("");
    const form = new FormData(e.currentTarget);
    try {
      const res = await fetch(`/api/empresas/${slug}/flota/combustible${vale ? `/${vale.id}` : ""}`, { method: vale ? "PATCH" : "POST", body: form });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "No se pudo guardar el vale.");
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : "Error al guardar."); }
    finally { enCurso.current = false; setGuardando(false); }
  }}>
    <h2 className="font-semibold">{vale ? `Editar vale #${vale.id}` : "Registrar vale"}</h2>
    {error && <p role="alert" className="text-red-500">{error}</p>}
    <div className="grid gap-3 md:grid-cols-3">
      <label>Proveedor<select className={input} name="proveedorId" required value={proveedorId} onChange={e => { setProveedorId(e.target.value); setEstacionId(estacionAlCambiarProveedor(catalogos.estaciones, e.target.value, estacionId)); }}>
        <option value="">Seleccionar proveedor</option>
        {vale?.proveedorId && !catalogos.proveedores.some(p => p.id === vale.proveedorId) && <option value={vale.proveedorId}>Proveedor histórico #{vale.proveedorId}</option>}
        {catalogos.proveedores.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
      </select></label>
      <label>Unidad / placa<select className={input} name="vehiculoId" required value={vehiculoId} onChange={e => setVehiculoId(e.target.value)}>
        <option value="">Seleccionar unidad</option>
        {vale?.vehiculoId && !catalogos.vehiculos.some(v => v.id === vale.vehiculoId) && <option value={vale.vehiculoId}>{vale.placa} · Histórico</option>}
        {catalogos.vehiculos.map(v => <option key={v.id} value={v.id}>{v.placa} {v.descripcion}</option>)}
      </select></label>
      <label>Número de vale<input className={input} name="numeroVale" required maxLength={40} defaultValue={vale?.numeroVale ?? ""} /></label>
      <label>Fecha de consumo<input className={input} name="fechaConsumo" type="date" required defaultValue={vale?.fechaConsumo ?? ""} /></label>
      <label>Combustible<select className={input} name="tipoCombustible" defaultValue={vale?.tipoCombustible ?? "diesel"}><option value="diesel">Diesel</option><option value="gasolina">Gasolina</option></select></label>
      <label>Galones<input className={input} name="galones" type="number" min="0.001" step="0.001" required value={galones} onChange={e => setGalones(e.target.value)} /></label>
      <label>Monto Q<input className={input} name="monto" type="number" min="0.01" step="0.01" required value={monto} onChange={e => setMonto(e.target.value)} /></label>
      <p>Precio por galón calculado: Q{precio}</p>
      <label>Kilometraje (opcional)<input className={input} name="km" type="number" min="0" step="1" defaultValue={vale?.km ?? ""} /></label>
      <label>Estación / gasolinera<select className={input} name="estacionId" value={estacionId} disabled={!proveedorId} onChange={e => setEstacionId(e.target.value)}>
        <option value="">Sin estación catalogada</option>
        {vale?.estacionId && String(vale.proveedorId) === proveedorId && !estaciones.some(e => e.id === vale.estacionId) && <option value={vale.estacionId}>{vale.gasolinera ?? `Estación #${vale.estacionId}`} · Histórico</option>}
        {estaciones.map(e => <option key={e.id} value={e.id}>{e.id === vale?.estacionId && vale.gasolinera ? vale.gasolinera : e.nombre}</option>)}
      </select>{!estacionId && vale?.gasolinera && <small>Texto histórico conservado: {vale.gasolinera}</small>}</label>
      <label>ID de viaje Flota (opcional)<input className={input} name="viajeId" type="number" min="1" step="1" defaultValue={vale?.viajeId ?? ""} /><small>Solo trazabilidad; debe corresponder a esta unidad.</small></label>
      <label>Evidencia imagen/PDF<input className={input} name="file" type="file" accept="image/jpeg,image/png,image/webp,image/bmp,application/pdf" required={!vale} /><small>{vale ? "Sin archivo nuevo se conserva el existente." : "Una evidencia obligatoria."}</small></label>
      <label>Observaciones<textarea className={input} name="observaciones" maxLength={1000} defaultValue={vale?.observaciones ?? ""} /></label>
    </div>
    <button disabled={guardando} className="rounded bg-sky-700 px-3 py-2 text-white">{guardando ? "Guardando…" : "Guardar vale"}</button>{" "}
    <button type="button" disabled={guardando} onClick={onCancel}>Cancelar</button>
  </form>;
}
