"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { precioCalculado } from "@/lib/flota/combustible-staff-schema";
import { MENSAJE_SIN_ESTACIONES, opcionesEstacion, opcionesVehiculo, requiereRegistrarEstaciones, type EstacionOpcion, type VehiculoOpcion } from "@/lib/flota/combustible-estaciones-ui";
import { CatalogoSearchSelect } from "@/components/tms/catalogo-search-select";
import { FondoCombustibleSelector } from "./combustible-fondo";
import type { LineaFondoCombustible } from "@/lib/flota/combustible-fondos";

export type ValeEditable = {
  id: number; vehiculoId?: number; proveedorId?: number | null; viajeId: number | null;
  numeroVale: string | null; fechaConsumo: string | null; tipoCombustible: string;
  galones: number; monto: number; km: number | null; gasolinera: string | null;
  observaciones?: string | null; placa: string;
  estacionId?: number | null;
  solicitudFondoLineaId?: number | null;
  fondo?: LineaFondoCombustible | null;
};
type Catalogos = { vehiculos: VehiculoOpcion[]; estaciones: EstacionOpcion[] };
const input = "w-full rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1.5";
/**
 * Registrar/editar vale. NO hay selector de proveedor: el proveedor se DERIVA de la estación en el servidor (que además revalida
 * empresa, actividad y pertenencia). La unidad y la estación se eligen en buscadores; ninguna admite texto manual.
 */
export function CombustibleRegistro({ slug, vale, onSaved, onCancel }: { slug: string; vale?: ValeEditable; onSaved: () => void; onCancel: () => void }) {
  const [catalogos, setCatalogos] = useState<Catalogos>({ vehiculos: [], estaciones: [] });
  const [cargado, setCargado] = useState(false);
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [galones, setGalones] = useState(String(vale?.galones ?? ""));
  const [monto, setMonto] = useState(String(vale?.monto ?? ""));
  const [vehiculoId, setVehiculoId] = useState(String(vale?.vehiculoId ?? ""));
  const [estacionId, setEstacionId] = useState(String(vale?.estacionId ?? ""));
  const [lineaFondo, setLineaFondo] = useState(String(vale?.solicitudFondoLineaId ?? ""));
  const opcionesUnidad = opcionesVehiculo(catalogos.vehiculos, { id: vale?.vehiculoId, placa: vale?.placa });
  const opcionesEstaciones = opcionesEstacion(catalogos.estaciones, { id: vale?.estacionId, nombre: vale?.gasolinera });
  // Un vale histórico SIN estación puede seguir sin ella (se conserva el texto); los demás exigen estación catalogada.
  const exigeEstacion = !vale || vale.estacionId != null;
  const sinEstacionesDisponibles = requiereRegistrarEstaciones(cargado, exigeEstacion, opcionesEstaciones);
  const enCurso = useRef(false);
  useEffect(() => {
    const ac = new AbortController();
    fetch(`/api/empresas/${slug}/flota/combustible/catalogos`, { signal: ac.signal }).then(async res => {
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "No se pudieron cargar los catálogos.");
      setCatalogos({ vehiculos: json.vehiculos ?? [], estaciones: json.estaciones ?? [] });
      setCargado(true);
    }).catch(e => { if (!ac.signal.aborted) setError(e.message); });
    return () => ac.abort();
  }, [slug]);
  let precio = "—";
  try { if (Number(galones) > 0 && Number(monto) > 0) precio = precioCalculado(monto, galones); } catch { /* incompleto */ }
  return <form className="space-y-3 rounded border border-[var(--border)] p-4" onSubmit={async e => {
    e.preventDefault();
    if (enCurso.current) return;
    if (!vehiculoId) { setError("Selecciona la unidad / placa."); return; }
    if (exigeEstacion && !estacionId) { setError(sinEstacionesDisponibles ? MENSAJE_SIN_ESTACIONES : "Selecciona la estación de combustible."); return; }
    enCurso.current = true; setGuardando(true); setError("");
    const form = new FormData(e.currentTarget);
    try {
      const res = await fetch(`/api/empresas/${slug}/flota/combustible${vale ? `/${vale.id}` : ""}`, { method: vale ? "PATCH" : "POST", body: form });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "No se pudo guardar el vale.");
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : "Error al guardar."); }
    finally { enCurso.current = false; setGuardando(false); }
  }}>
    <h2 className="font-semibold">{vale ? `Editar vale #${vale.id}` : "Registrar vale"}</h2>
    {error && <p role="alert" className="text-red-500">{error}</p>}
    <div className="grid gap-3 md:grid-cols-3">
      <div><input type="hidden" name="vehiculoId" value={vehiculoId} />
        <CatalogoSearchSelect label="Unidad / placa" placeholder="Buscar placa o unidad..." value={vehiculoId} options={opcionesUnidad} inputClassName={input} onChange={setVehiculoId} />
      </div>
      <label>Número de vale<input className={input} name="numeroVale" required maxLength={40} defaultValue={vale?.numeroVale ?? ""} /></label>
      <label>Fecha de consumo<input className={input} name="fechaConsumo" type="date" required defaultValue={vale?.fechaConsumo ?? ""} /></label>
      <label>Combustible<select className={input} name="tipoCombustible" defaultValue={vale?.tipoCombustible ?? "diesel"}><option value="diesel">Diesel</option><option value="gasolina">Gasolina</option></select></label>
      <label>Galones<input className={input} name="galones" type="number" min="0.001" step="0.001" required value={galones} onChange={e => setGalones(e.target.value)} /></label>
      <label>Monto Q<input className={input} name="monto" type="number" min="0.01" step="0.01" required value={monto} onChange={e => setMonto(e.target.value)} /></label>
      <p>Precio por galón calculado: Q{precio}</p>
      <label>Kilometraje (opcional)<input className={input} name="km" type="number" min="0" step="1" defaultValue={vale?.km ?? ""} /></label>
      <div><input type="hidden" name="estacionId" value={estacionId} />
        <CatalogoSearchSelect label="Estación / gasolinera" placeholder="Buscar estación o proveedor..." value={estacionId} options={opcionesEstaciones} inputClassName={input} emptyLabel={exigeEstacion ? "— Seleccionar estación —" : "Sin estación catalogada (histórico)"} onChange={setEstacionId} />
        {sinEstacionesDisponibles && <p role="status" className="mt-1 text-xs text-amber-500">{MENSAJE_SIN_ESTACIONES} <Link href={`/e/${slug}/combustibles/estaciones`} prefetch={false} className="underline">Ir a Estaciones de combustible</Link></p>}
        {!estacionId && vale?.gasolinera && <small>Texto histórico conservado: {vale.gasolinera}</small>}
      </div>
      <label>Evidencia imagen/PDF<input className={input} name="file" type="file" accept="image/jpeg,image/png,image/webp,image/bmp,application/pdf" required={!vale} /><small>{vale ? "Sin archivo nuevo se conserva el existente." : "Una evidencia obligatoria."}</small></label>
      <label>Observaciones<textarea className={input} name="observaciones" maxLength={1000} defaultValue={vale?.observaciones ?? ""} /></label>
    </div>
    <FondoCombustibleSelector slug={slug} value={lineaFondo} onChange={setLineaFondo} historico={vale?.fondo} />
    <button disabled={guardando || sinEstacionesDisponibles} className="rounded bg-sky-700 px-3 py-2 text-white disabled:opacity-50">{guardando ? "Guardando…" : "Guardar vale"}</button>{" "}
    <button type="button" disabled={guardando} onClick={onCancel}>Cancelar</button>
  </form>;
}
