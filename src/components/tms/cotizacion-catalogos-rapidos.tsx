"use client";

import { useState } from "react";
import type { RutaOpt } from "./ruta-select";

const input = "rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1.5 text-sm";

export function CotizacionCatalogosRapidos({ slug, clienteId, puedeCrearCliente, puedeCrearRuta, onCliente, onRuta }: {
  slug: string; clienteId: number; puedeCrearCliente: boolean; puedeCrearRuta: boolean;
  onCliente: (cliente: { id: number; nombre: string }) => void; onRuta: (ruta: RutaOpt) => void;
}) {
  const [modal, setModal] = useState<"cliente" | "ruta" | null>(null);
  const [error, setError] = useState("");
  const [cliente, setCliente] = useState({ nombre: "", razonSocial: "", codigo: "", nit: "", telefono: "", email: "" });
  const [ruta, setRuta] = useState({ codigo: "", nombre: "", origen: "", destino: "", tarifa: "", refrigerada: false, observaciones: "" });
  const [unidades, setUnidades] = useState<{ id: number; placa: string; marca?: string | null; modelo?: string | null }[]>([]);
  const [unidadId, setUnidadId] = useState(0);
  const [codigoSugerido, setCodigoSugerido] = useState("");

  async function abrirRuta() {
    setError("");
    const [res, catalogosRes] = await Promise.all([fetch(`/api/empresas/${slug}/tms/rutas?sugerirCodigo=1`, { cache: "no-store" }), fetch(`/api/empresas/${slug}/tms/catalogos`, { cache: "no-store" })]);
    const [data, catalogos] = await Promise.all([res.json().catch(() => ({})), catalogosRes.json().catch(() => ({}))]);
    setUnidades(catalogosRes.ok ? (catalogos.flotaVehiculos ?? []) : []);
    setRuta((r) => ({ ...r, codigo: res.ok ? String(data.codigo ?? "") : "" }));
    setCodigoSugerido(res.ok ? String(data.codigo ?? "") : "");
    setModal("ruta");
  }
  async function crearCliente() {
    setError("");
    const res = await fetch(`/api/empresas/${slug}/clientes`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cliente) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setError(data.error ?? "No se pudo crear el cliente.");
    const tmsId = Number(data.cliente?.tmsClienteId);
    if (!tmsId) return setError("El cliente se creó, pero no pudo vincularse al catálogo TMS.");
    onCliente({ id: tmsId, nombre: String(data.cliente.nombre) });
    setCliente({ nombre: "", razonSocial: "", codigo: "", nit: "", telefono: "", email: "" }); setModal(null);
  }
  async function crearRuta() {
    setError("");
    if (!clienteId) return setError("Selecciona primero el cliente de la ruta.");
    const body = { clienteId, codigo: ruta.codigo, generarCodigo: Boolean(codigoSugerido && ruta.codigo === codigoSugerido), nombre: ruta.nombre || undefined, lugarCargaTexto: ruta.origen || undefined,
      destinoDescripcion: ruta.destino || undefined, tarifaReferencia: ruta.tarifa === "" ? null : Number(ruta.tarifa),
      servicioRefrigeradoHabitual: ruta.refrigerada, unidadRecurrenteId: unidadId || null, observaciones: ruta.observaciones || undefined };
    const res = await fetch(`/api/empresas/${slug}/tms/rutas`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setError(data.error ?? "No se pudo crear la ruta.");
    onRuta(data.ruta as RutaOpt); setModal(null);
  }
  return <>
    <div className="flex flex-wrap gap-2 text-xs">
      {puedeCrearCliente ? <button type="button" className="text-[var(--accent)]" onClick={() => { setError(""); setModal("cliente"); }}>+ Crear cliente</button> : null}
      {puedeCrearRuta ? <button type="button" className="text-[var(--accent)]" onClick={() => void abrirRuta()}>+ Crear nueva ruta</button> : null}
    </div>
    {modal ? <div role="dialog" aria-modal="true" className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-xl space-y-3 rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4">
        <h2 className="font-semibold">{modal === "cliente" ? "Crear cliente" : "Crear ruta"}</h2>
        {modal === "cliente" ? <div className="grid gap-2 md:grid-cols-2">
          {([['nombre','Nombre / razón social *'],['razonSocial','Razón social'],['codigo','Código'],['nit','NIT'],['telefono','Teléfono'],['email','Correo']] as const).map(([k,l]) => <label key={k} className="text-xs text-[var(--muted)]">{l}<input className={`${input} mt-1 w-full`} value={cliente[k]} onChange={(e) => setCliente((x) => ({ ...x, [k]: e.target.value }))} /></label>)}
        </div> : <div className="grid gap-2 md:grid-cols-2">
          <label className="text-xs">Código *<input className={`${input} mt-1 w-full`} value={ruta.codigo} onChange={(e) => setRuta((x) => ({ ...x, codigo: e.target.value }))} /></label>
          <label className="text-xs">Nombre de ruta<input className={`${input} mt-1 w-full`} value={ruta.nombre} onChange={(e) => setRuta((x) => ({ ...x, nombre: e.target.value }))} /></label>
          <label className="text-xs">Origen<input className={`${input} mt-1 w-full`} value={ruta.origen} onChange={(e) => setRuta((x) => ({ ...x, origen: e.target.value }))} /></label>
          <label className="text-xs">Destino<input className={`${input} mt-1 w-full`} value={ruta.destino} onChange={(e) => setRuta((x) => ({ ...x, destino: e.target.value }))} /></label>
          <label className="text-xs">Tarifa de referencia<input type="number" min="0" step="0.01" className={`${input} mt-1 w-full`} value={ruta.tarifa} onChange={(e) => setRuta((x) => ({ ...x, tarifa: e.target.value }))} /></label>
          <label className="text-xs">Unidad / perfil habitual (opcional)<select className={`${input} mt-1 w-full`} value={unidadId} onChange={(e) => setUnidadId(Number(e.target.value))}><option value={0}>Sin unidad habitual</option>{unidades.map((u) => <option key={u.id} value={u.id}>{u.placa}{u.marca ? ` · ${u.marca}` : ""}{u.modelo ? ` ${u.modelo}` : ""}</option>)}</select></label>
          <label className="mt-5 flex items-center gap-2 text-xs"><input type="checkbox" checked={ruta.refrigerada} onChange={(e) => setRuta((x) => ({ ...x, refrigerada: e.target.checked }))} /> Refrigerada</label>
          <label className="text-xs md:col-span-2">Observaciones<textarea className={`${input} mt-1 w-full`} value={ruta.observaciones} onChange={(e) => setRuta((x) => ({ ...x, observaciones: e.target.value }))} /></label>
        </div>}
        {error ? <p role="alert" className="text-sm text-red-300">{error}</p> : null}
        <div className="flex gap-2"><button type="button" className="rounded bg-[var(--accent)] px-3 py-1.5 text-sm text-white" onClick={() => void (modal === "cliente" ? crearCliente() : crearRuta())}>Guardar</button><button type="button" className="rounded border border-[var(--border)] px-3 py-1.5 text-sm" onClick={() => setModal(null)}>Cancelar</button></div>
      </div>
    </div> : null}
  </>;
}
