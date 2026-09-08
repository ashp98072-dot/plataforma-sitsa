"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { ClienteSearch } from "@/components/tms/cliente-search";
import { RutaSelect, type RutaOpt } from "@/components/tms/ruta-select";
import { aplicarDefaultsRutaCotizacion } from "@/lib/tms/cotizacion-defaults";

type ClienteOpt = { id: number; nombre: string; codigo?: string | null; nit?: string | null; telefono?: string | null; estado?: string | null };

type EstadoCotizacion = "Borrador" | "Enviada" | "Aceptada" | "Rechazada" | "Vencida";

type Cotizacion = {
  id: number;
  codigo: string;
  clienteId: number;
  clienteNombre: string;
  rutaId: number | null;
  rutaCodigoHistorico: string | null;
  origenTexto: string | null;
  destinoTexto: string | null;
  tarifaReferencia: number | null;
  costoOperativoReferencia: number | null;
  tarifaCotizada: number;
  incluyeIva: boolean;
  moneda: string;
  fechaEmision: string;
  fechaVencimiento: string | null;
  estado: EstadoCotizacion;
  pilotoIncluido: boolean;
  gpsIncluido: boolean;
  seguroMercaderiaIncluido: boolean;
  seguroTercerosIncluido: boolean;
  kmIncluidos: number | null;
  tarifaKmAdicional: number | null;
  condicionesAdicionales: string | null;
  observaciones: string | null;
};

const inputCls = "rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1.5 text-sm";
const IVA = 0.12;
const money = (n: number | null) => (n == null ? "—" : `Q${n.toLocaleString("es-GT", { minimumFractionDigits: 2 })}`);

function desgloseIva(tarifa: number, incluyeIva: boolean) {
  if (incluyeIva) {
    const subtotal = tarifa / (1 + IVA);
    return { subtotal, iva: tarifa - subtotal, total: tarifa };
  }
  const iva = tarifa * IVA;
  return { subtotal: tarifa, iva, total: tarifa + iva };
}

const FORM_VACIO = {
  clienteId: 0,
  clienteNombre: "",
  rutaId: null as number | null,
  rutaCodigo: "",
  origenTexto: "",
  destinoTexto: "",
  tarifaCotizada: "",
  incluyeIva: false,
  fechaEmision: new Date().toISOString().slice(0, 10),
  fechaVencimiento: "",
  pilotoIncluido: true,
  gpsIncluido: false,
  seguroMercaderiaIncluido: false,
  seguroTercerosIncluido: false,
  kmIncluidos: "",
  tarifaKmAdicional: "",
  condicionesAdicionales: "",
  observaciones: "",
};

/**
 * COTIZADOR-TMS-1 — cotizaciones comerciales de TMS. Al elegir una ruta
 * se sugieren tarifa/origen/destino (aplicarDefaultsRutaCotizacion,
 * src/lib/tms/cotizacion-defaults.ts) sin pisar lo que el usuario ya
 * haya editado a mano — mismo criterio que Programación con
 * ruta-defaults.ts.
 */
export default function CotizacionesPage() {
  const slug = String(useParams().slug);

  const [clientes, setClientes] = useState<ClienteOpt[]>([]);
  const [cotizaciones, setCotizaciones] = useState<Cotizacion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  const [fClienteId, setFClienteId] = useState(0);
  const [fClienteNombre, setFClienteNombre] = useState("");
  const [fEstado, setFEstado] = useState("");
  const [fFechaDesde, setFFechaDesde] = useState("");
  const [fFechaHasta, setFFechaHasta] = useState("");

  const [mostrarForm, setMostrarForm] = useState(false);
  const [editandoId, setEditandoId] = useState<number | null>(null);
  const [form, setForm] = useState(FORM_VACIO);
  const [expandidoId, setExpandidoId] = useState<number | null>(null);

  const cargarClientes = useCallback(async () => {
    const res = await fetch(`/api/empresas/${slug}/tms/catalogos`);
    const data = await res.json().catch(() => ({}));
    if (res.ok) setClientes(data.tmsClientes ?? []);
  }, [slug]);

  const cargar = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams();
      if (fClienteId) params.set("clienteId", String(fClienteId));
      if (fEstado) params.set("estado", fEstado);
      if (fFechaDesde) params.set("fechaDesde", fFechaDesde);
      if (fFechaHasta) params.set("fechaHasta", fFechaHasta);
      const res = await fetch(`/api/empresas/${slug}/tms/cotizaciones?${params.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "No se pudieron cargar las cotizaciones.");
      setCotizaciones(data.cotizaciones ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar.");
    } finally {
      setLoading(false);
    }
  }, [slug, fClienteId, fEstado, fFechaDesde, fFechaHasta]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void cargarClientes();
  }, [cargarClientes]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void cargar();
  }, [cargar]);

  function nueva() {
    setEditandoId(null);
    setForm(FORM_VACIO);
    setMostrarForm(true);
  }

  function editar(c: Cotizacion) {
    setEditandoId(c.id);
    setForm({
      clienteId: c.clienteId,
      clienteNombre: c.clienteNombre,
      rutaId: c.rutaId,
      rutaCodigo: c.rutaCodigoHistorico ?? "",
      origenTexto: c.origenTexto ?? "",
      destinoTexto: c.destinoTexto ?? "",
      tarifaCotizada: String(c.tarifaCotizada),
      incluyeIva: c.incluyeIva,
      fechaEmision: c.fechaEmision,
      fechaVencimiento: c.fechaVencimiento ?? "",
      pilotoIncluido: c.pilotoIncluido,
      gpsIncluido: c.gpsIncluido,
      seguroMercaderiaIncluido: c.seguroMercaderiaIncluido,
      seguroTercerosIncluido: c.seguroTercerosIncluido,
      kmIncluidos: c.kmIncluidos != null ? String(c.kmIncluidos) : "",
      tarifaKmAdicional: c.tarifaKmAdicional != null ? String(c.tarifaKmAdicional) : "",
      condicionesAdicionales: c.condicionesAdicionales ?? "",
      observaciones: c.observaciones ?? "",
    });
    setMostrarForm(true);
  }

  function aplicarRuta(ruta: RutaOpt) {
    const defaults = aplicarDefaultsRutaCotizacion(
      { tarifaCotizada: form.tarifaCotizada, origenTexto: form.origenTexto, destinoTexto: form.destinoTexto },
      { tarifaReferencia: ruta.tarifaReferencia, costoOperativo: ruta.costoOperativo, origenTexto: ruta.lugarCargaTexto, destinoTexto: ruta.destinoDescripcion },
    );
    setForm((f) => ({
      ...f,
      rutaId: ruta.id,
      rutaCodigo: ruta.codigo,
      tarifaCotizada: defaults.tarifaCotizada,
      origenTexto: defaults.origenTexto,
      destinoTexto: defaults.destinoTexto,
    }));
  }

  async function guardar() {
    setError(""); setMsg("");
    if (!form.clienteId) { setError("Selecciona un cliente."); return; }
    if (!(Number(form.tarifaCotizada) > 0)) { setError("La tarifa cotizada debe ser mayor a cero."); return; }
    const payload = {
      clienteId: form.clienteId,
      rutaId: form.rutaId,
      origenTexto: form.origenTexto.trim() || null,
      destinoTexto: form.destinoTexto.trim() || null,
      tarifaCotizada: Number(form.tarifaCotizada),
      incluyeIva: form.incluyeIva,
      fechaEmision: form.fechaEmision,
      fechaVencimiento: form.fechaVencimiento || null,
      pilotoIncluido: form.pilotoIncluido,
      gpsIncluido: form.gpsIncluido,
      seguroMercaderiaIncluido: form.seguroMercaderiaIncluido,
      seguroTercerosIncluido: form.seguroTercerosIncluido,
      kmIncluidos: form.kmIncluidos === "" ? null : Number(form.kmIncluidos),
      tarifaKmAdicional: form.tarifaKmAdicional === "" ? null : Number(form.tarifaKmAdicional),
      condicionesAdicionales: form.condicionesAdicionales.trim() || null,
      observaciones: form.observaciones.trim() || null,
    };
    const url = editandoId ? `/api/empresas/${slug}/tms/cotizaciones/${editandoId}` : `/api/empresas/${slug}/tms/cotizaciones`;
    const res = await fetch(url, { method: editandoId ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setError(data.error ?? "No se pudo guardar."); return; }
    setMsg(data.mensaje ?? "Guardado.");
    setMostrarForm(false);
    await cargar();
  }

  async function cambiarEstado(id: number, estado: EstadoCotizacion) {
    setError(""); setMsg("");
    const res = await fetch(`/api/empresas/${slug}/tms/cotizaciones/${id}/estado`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ estado }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setError(data.error ?? "No se pudo cambiar el estado."); return; }
    setMsg(data.mensaje ?? "Estado actualizado.");
    await cargar();
  }

  async function duplicar(id: number) {
    setError(""); setMsg("");
    const res = await fetch(`/api/empresas/${slug}/tms/cotizaciones/${id}/duplicar`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setError(data.error ?? "No se pudo duplicar."); return; }
    setMsg(`Duplicada como ${data.cotizacion?.codigo ?? "nueva cotización"} (Borrador).`);
    await cargar();
  }

  const ESTADO_COLOR: Record<EstadoCotizacion, string> = {
    Borrador: "text-[var(--muted)]",
    Enviada: "text-amber-400",
    Aceptada: "text-emerald-400",
    Rechazada: "text-red-400",
    Vencida: "text-red-300",
  };

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">Cotizaciones</h1>
        <button type="button" onClick={nueva} className="rounded bg-[var(--accent)] px-3 py-2 text-sm text-white">Nueva cotización</button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-[220px]">
          <ClienteSearch clientes={clientes} valueNombre={fClienteNombre} valueId={fClienteId}
            onChange={({ clienteId, clienteNombre }) => { setFClienteId(clienteId); setFClienteNombre(clienteNombre); }}
            inputClassName={inputCls} />
        </div>
        <select className={inputCls} value={fEstado} onChange={(e) => setFEstado(e.target.value)}>
          <option value="">Todos los estados</option>
          {["Borrador", "Enviada", "Aceptada", "Rechazada", "Vencida"].map((e) => <option key={e} value={e}>{e}</option>)}
        </select>
        <input type="date" className={inputCls} value={fFechaDesde} onChange={(e) => setFFechaDesde(e.target.value)} />
        <input type="date" className={inputCls} value={fFechaHasta} onChange={(e) => setFFechaHasta(e.target.value)} />
      </div>

      {error ? <p className="text-sm text-red-300">{error}</p> : null}
      {msg ? <p className="text-sm text-emerald-300">{msg}</p> : null}

      {mostrarForm ? (
        <div className="space-y-2 rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3">
          <p className="text-sm font-medium">{editandoId ? "Editar cotización (solo en Borrador)" : "Nueva cotización"}</p>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
            <label className="text-xs text-[var(--muted)]">Cliente
              <ClienteSearch clientes={clientes} valueNombre={form.clienteNombre} valueId={form.clienteId}
                onChange={({ clienteId, clienteNombre }) => setForm((f) => ({ ...f, clienteId, clienteNombre }))}
                inputClassName={`${inputCls} mt-0.5 w-full`} />
            </label>
            <label className="text-xs text-[var(--muted)]">Ruta (opcional — sugiere tarifa/origen/destino)
              <RutaSelect slug={slug} clienteId={form.clienteId} value={form.rutaCodigo} inputClassName={`${inputCls} mt-0.5 w-full`}
                onSeleccionar={aplicarRuta} />
            </label>
            <label className="text-xs text-[var(--muted)]">Fecha de emisión
              <input type="date" className={`${inputCls} mt-0.5 w-full`} value={form.fechaEmision} onChange={(e) => setForm((f) => ({ ...f, fechaEmision: e.target.value }))} />
            </label>
            <label className="text-xs text-[var(--muted)]">Origen
              <input className={`${inputCls} mt-0.5 w-full`} value={form.origenTexto} onChange={(e) => setForm((f) => ({ ...f, origenTexto: e.target.value }))} />
            </label>
            <label className="text-xs text-[var(--muted)]">Destino
              <input className={`${inputCls} mt-0.5 w-full`} value={form.destinoTexto} onChange={(e) => setForm((f) => ({ ...f, destinoTexto: e.target.value }))} />
            </label>
            <label className="text-xs text-[var(--muted)]">Fecha de vencimiento
              <input type="date" className={`${inputCls} mt-0.5 w-full`} value={form.fechaVencimiento} onChange={(e) => setForm((f) => ({ ...f, fechaVencimiento: e.target.value }))} />
            </label>
            <label className="text-xs text-[var(--muted)]">Tarifa cotizada (Q)
              <input type="number" min="0.01" step="0.01" className={`${inputCls} mt-0.5 w-full`} value={form.tarifaCotizada} onChange={(e) => setForm((f) => ({ ...f, tarifaCotizada: e.target.value }))} />
            </label>
            <label className="mt-4 flex items-center gap-2 text-xs text-[var(--muted)]">
              <input type="checkbox" checked={form.incluyeIva} onChange={(e) => setForm((f) => ({ ...f, incluyeIva: e.target.checked }))} />
              La tarifa ya incluye IVA
            </label>
            {form.tarifaCotizada ? (
              <p className="text-xs text-[var(--muted)] md:col-span-3">
                {(() => { const d = desgloseIva(Number(form.tarifaCotizada) || 0, form.incluyeIva);
                  return `Subtotal ${money(d.subtotal)} · IVA (12%) ${money(d.iva)} · Total ${money(d.total)}`; })()}
              </p>
            ) : null}
          </div>

          <p className="mt-2 text-xs font-medium text-[var(--muted)]">Condiciones de servicio</p>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={form.pilotoIncluido} onChange={(e) => setForm((f) => ({ ...f, pilotoIncluido: e.target.checked }))} /> Piloto incluido</label>
            <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={form.gpsIncluido} onChange={(e) => setForm((f) => ({ ...f, gpsIncluido: e.target.checked }))} /> GPS</label>
            <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={form.seguroMercaderiaIncluido} onChange={(e) => setForm((f) => ({ ...f, seguroMercaderiaIncluido: e.target.checked }))} /> Seguro de mercadería</label>
            <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={form.seguroTercerosIncluido} onChange={(e) => setForm((f) => ({ ...f, seguroTercerosIncluido: e.target.checked }))} /> Seguro contra terceros</label>
            <label className="text-xs text-[var(--muted)]">Km incluidos
              <input type="number" min="0" step="0.01" className={`${inputCls} mt-0.5 w-full`} value={form.kmIncluidos} onChange={(e) => setForm((f) => ({ ...f, kmIncluidos: e.target.value }))} />
            </label>
            <label className="text-xs text-[var(--muted)]">Tarifa por km adicional (Q)
              <input type="number" min="0" step="0.01" className={`${inputCls} mt-0.5 w-full`} value={form.tarifaKmAdicional} onChange={(e) => setForm((f) => ({ ...f, tarifaKmAdicional: e.target.value }))} />
            </label>
          </div>
          <label className="block text-xs text-[var(--muted)]">Condiciones adicionales
            <textarea className={`${inputCls} mt-0.5 w-full`} value={form.condicionesAdicionales} onChange={(e) => setForm((f) => ({ ...f, condicionesAdicionales: e.target.value }))} />
          </label>
          <label className="block text-xs text-[var(--muted)]">Observaciones
            <textarea className={`${inputCls} mt-0.5 w-full`} value={form.observaciones} onChange={(e) => setForm((f) => ({ ...f, observaciones: e.target.value }))} />
          </label>
          <div className="flex gap-2">
            <button type="button" onClick={() => void guardar()} className="rounded bg-[var(--accent)] px-3 py-1.5 text-sm text-white">Guardar</button>
            <button type="button" onClick={() => setMostrarForm(false)} className="rounded border border-[var(--border)] px-3 py-1.5 text-sm">Cancelar</button>
          </div>
        </div>
      ) : null}

      <div className="space-y-2">
        {cotizaciones.map((c) => (
          <div key={c.id} className="rounded-lg border border-[var(--border)] p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="font-medium">{c.codigo}</span> · {c.clienteNombre} · {c.fechaEmision} ·{" "}
                <span className={ESTADO_COLOR[c.estado]}>{c.estado}</span> · {money(c.tarifaCotizada)}
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <button type="button" onClick={() => setExpandidoId(expandidoId === c.id ? null : c.id)} className="text-[var(--accent)]">
                  {expandidoId === c.id ? "Ocultar detalle" : "Ver detalle"}
                </button>
                {c.estado === "Borrador" ? <button type="button" onClick={() => editar(c)} className="text-[var(--accent)]">Editar</button> : null}
                <a href={`/api/empresas/${slug}/tms/cotizaciones/${c.id}/pdf`} className="rounded border border-[var(--border)] px-2 py-1">Descargar PDF</a>
                <button type="button" onClick={() => void duplicar(c.id)} className="rounded border border-[var(--border)] px-2 py-1">Duplicar</button>
                {c.estado === "Borrador" ? <button type="button" onClick={() => void cambiarEstado(c.id, "Enviada")} className="rounded bg-amber-600 px-2 py-1 text-white">Marcar enviada</button> : null}
                {c.estado === "Enviada" ? (
                  <>
                    <button type="button" onClick={() => void cambiarEstado(c.id, "Aceptada")} className="rounded bg-emerald-600 px-2 py-1 text-white">Aceptada</button>
                    <button type="button" onClick={() => void cambiarEstado(c.id, "Rechazada")} className="rounded bg-red-600 px-2 py-1 text-white">Rechazada</button>
                    <button type="button" onClick={() => void cambiarEstado(c.id, "Vencida")} className="rounded border border-[var(--border)] px-2 py-1">Marcar vencida</button>
                  </>
                ) : null}
              </div>
            </div>
            {expandidoId === c.id ? (
              <div className="mt-2 grid grid-cols-2 gap-1 text-xs md:grid-cols-3">
                <div><span className="text-[var(--muted)]">Origen:</span> {c.origenTexto ?? "—"}</div>
                <div><span className="text-[var(--muted)]">Destino:</span> {c.destinoTexto ?? "—"}</div>
                <div><span className="text-[var(--muted)]">Ruta:</span> {c.rutaCodigoHistorico ?? "—"}</div>
                <div><span className="text-[var(--muted)]">Tarifa referencia:</span> {money(c.tarifaReferencia)}</div>
                <div><span className="text-[var(--muted)]">Costo operativo ref.:</span> {money(c.costoOperativoReferencia)}</div>
                <div><span className="text-[var(--muted)]">Vigencia:</span> {c.fechaVencimiento ?? "—"}</div>
                <div><span className="text-[var(--muted)]">Piloto incluido:</span> {c.pilotoIncluido ? "Sí" : "No"}</div>
                <div><span className="text-[var(--muted)]">GPS:</span> {c.gpsIncluido ? "Sí" : "No"}</div>
                <div><span className="text-[var(--muted)]">Seguro mercadería:</span> {c.seguroMercaderiaIncluido ? "Sí" : "No"}</div>
                <div><span className="text-[var(--muted)]">Seguro terceros:</span> {c.seguroTercerosIncluido ? "Sí" : "No"}</div>
                <div><span className="text-[var(--muted)]">Km incluidos:</span> {c.kmIncluidos ?? "—"}</div>
                <div><span className="text-[var(--muted)]">Tarifa km adicional:</span> {money(c.tarifaKmAdicional)}</div>
                {c.condicionesAdicionales ? <div className="md:col-span-3"><span className="text-[var(--muted)]">Condiciones:</span> {c.condicionesAdicionales}</div> : null}
                {c.observaciones ? <div className="md:col-span-3"><span className="text-[var(--muted)]">Observaciones:</span> {c.observaciones}</div> : null}
              </div>
            ) : null}
          </div>
        ))}
        {!cotizaciones.length && !loading ? <p className="text-[var(--muted)]">Sin cotizaciones con este filtro.</p> : null}
      </div>
    </div>
  );
}
