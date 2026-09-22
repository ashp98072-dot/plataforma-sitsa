"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { ClienteSearch } from "@/components/tms/cliente-search";
import { RutaSelect, type RutaOpt } from "@/components/tms/ruta-select";
import { aplicarDefaultsRutaCotizacion, sugerirServicioRefrigerado } from "@/lib/tms/cotizacion-defaults";
import { CosteoRegistradoDetalle, CotizacionCosteoPanel, useCosteoConfig } from "@/components/tms/cotizacion-costeo-panel";
import { aplicarPrecioSugerido, type PayloadCosteoCliente } from "@/lib/tms/cotizacion-costeo-ui";
import { CotizacionCatalogosRapidos } from "@/components/tms/cotizacion-catalogos-rapidos";
import { DOCUMENTOS_EMISOR, DOCUMENTO_EMISOR_DEFAULT, MARCAS_DOCUMENTO, type DocumentoEmisor } from "@/lib/tms/cotizacion-documento";

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
  servicioRefrigerado: boolean;
  kmIncluidos: number | null;
  tarifaKmAdicional: number | null;
  condicionesAdicionales: string | null;
  observaciones: string | null;
  documentoEmisor: DocumentoEmisor;
  atencionNombre: string | null;
  atencionCargo: string | null;
  unidadDescripcion: string | null;
  mensajeComercial: string | null;
  lineasAdicionales: LineaAdicional[];
};

/** Ruta/destino adicional a la línea principal (varias rutas en una sola cotización, cada una con su propio precio). */
type LineaAdicional = { id: number; orden: number; origenTexto: string | null; destinoTexto: string | null; unidadDescripcion: string | null; tarifaCotizada: number };
type LineaForm = { origenTexto: string; destinoTexto: string; unidadDescripcion: string; tarifaCotizada: string };
const LINEA_FORM_VACIA: LineaForm = { origenTexto: "", destinoTexto: "", unidadDescripcion: "", tarifaCotizada: "" };

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
  servicioRefrigerado: false,
  kmIncluidos: "",
  tarifaKmAdicional: "",
  condicionesAdicionales: "",
  observaciones: "",
  documentoEmisor: DOCUMENTO_EMISOR_DEFAULT as DocumentoEmisor,
  atencionNombre: "",
  atencionCargo: "",
  unidadDescripcion: "",
  mensajeComercial: "",
  lineasAdicionales: [] as LineaForm[],
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
  // COTIZACIONES-COSTEO: el backend decide (403 => la sección no aparece). El costeo es OPCIONAL.
  // La configuración visible (vigencia, margen) es la de la fecha de emisión del formulario: la misma que usa el cálculo real.
  const costeoConfig = useCosteoConfig(slug, form.fechaEmision);
  const [costeoPayload, setCosteoPayload] = useState<PayloadCosteoCliente | null>(null);
  const [permisosRapidos, setPermisosRapidos] = useState({ clientes: false, rutas: false });
  // PRESENTACIÓN COMERCIAL — mensaje predeterminado por marca (solo lectura aquí; se edita en
  // Ajustes de cotizaciones). `mensajeTocado`: una vez que el usuario edita el textarea a mano (o
  // carga una cotización ya guardada), cambiar de marca deja de pisarlo en silencio — se muestra
  // un aviso con el texto que se aplicaría, ver el bloque debajo del textarea.
  const [presentacion, setPresentacion] = useState<Record<DocumentoEmisor, { mensaje: string; cierre: string }> | null>(null);
  const [mensajeTocado, setMensajeTocado] = useState(false);

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
    fetch("/api/auth/me", { cache: "no-store" }).then((r) => r.json()).then((data) => {
      const ps = Array.isArray(data.permisos) ? data.permisos : [];
      const crear = (m: string) => Boolean(ps.find((p: { modulo?: string; puedeCrear?: boolean }) => p.modulo === m)?.puedeCrear);
      setPermisosRapidos({ clientes: crear("clientes"), rutas: crear("rutas") || crear("tms") });
    }).catch(() => setPermisosRapidos({ clientes: false, rutas: false }));
  }, []);
  useEffect(() => {
    fetch(`/api/empresas/${slug}/tms/cotizaciones/presentacion`, { cache: "no-store" }).then((r) => r.json()).then((data) => {
      if (data.presentacion) setPresentacion(data.presentacion);
    }).catch(() => {});
  }, [slug]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void cargar();
  }, [cargar]);
  useEffect(() => {
    if (!presentacion || editandoId != null || mensajeTocado || form.mensajeComercial) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setForm((f) => ({ ...f, mensajeComercial: presentacion[f.documentoEmisor]?.mensaje ?? "" }));
  }, [presentacion, editandoId, mensajeTocado, form.mensajeComercial, form.documentoEmisor]);

  function nueva() {
    setEditandoId(null);
    setCosteoPayload(null);
    setMensajeTocado(false);
    setForm({ ...FORM_VACIO, mensajeComercial: presentacion?.[DOCUMENTO_EMISOR_DEFAULT]?.mensaje ?? "" });
    setMostrarForm(true);
  }

  function editar(c: Cotizacion) {
    setEditandoId(c.id);
    setCosteoPayload(null);
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
      servicioRefrigerado: c.servicioRefrigerado,
      kmIncluidos: c.kmIncluidos != null ? String(c.kmIncluidos) : "",
      tarifaKmAdicional: c.tarifaKmAdicional != null ? String(c.tarifaKmAdicional) : "",
      condicionesAdicionales: c.condicionesAdicionales ?? "",
      observaciones: c.observaciones ?? "",
      documentoEmisor: c.documentoEmisor,
      atencionNombre: c.atencionNombre ?? "",
      atencionCargo: c.atencionCargo ?? "",
      unidadDescripcion: c.unidadDescripcion ?? "",
      mensajeComercial: c.mensajeComercial ?? "",
      lineasAdicionales: (c.lineasAdicionales ?? []).map((l) => ({
        origenTexto: l.origenTexto ?? "",
        destinoTexto: l.destinoTexto ?? "",
        unidadDescripcion: l.unidadDescripcion ?? "",
        tarifaCotizada: String(l.tarifaCotizada),
      })),
    });
    setMensajeTocado(true);
    setMostrarForm(true);
  }

  function agregarLinea() {
    setForm((f) => ({ ...f, lineasAdicionales: [...f.lineasAdicionales, { ...LINEA_FORM_VACIA }] }));
  }
  function actualizarLinea(indice: number, cambios: Partial<LineaForm>) {
    setForm((f) => ({ ...f, lineasAdicionales: f.lineasAdicionales.map((l, i) => (i === indice ? { ...l, ...cambios } : l)) }));
  }
  function quitarLinea(indice: number) {
    setForm((f) => ({ ...f, lineasAdicionales: f.lineasAdicionales.filter((_, i) => i !== indice) }));
  }

  function aplicarRuta(ruta: RutaOpt) {
    const defaults = aplicarDefaultsRutaCotizacion(
      { tarifaCotizada: form.tarifaCotizada, origenTexto: form.origenTexto, destinoTexto: form.destinoTexto },
      { tarifaReferencia: ruta.tarifaReferencia, origenTexto: ruta.lugarCargaTexto, destinoTexto: ruta.destinoDescripcion },
    );
    setForm((f) => ({
      ...f,
      rutaId: ruta.id,
      rutaCodigo: ruta.codigo,
      tarifaCotizada: defaults.tarifaCotizada,
      origenTexto: defaults.origenTexto,
      destinoTexto: defaults.destinoTexto,
      servicioRefrigerado: sugerirServicioRefrigerado(f.servicioRefrigerado, ruta.servicioRefrigeradoHabitual),
    }));
  }

  async function guardar() {
    setError(""); setMsg("");
    // El id sale solo de elegir un cliente de la lista (o de crearlo): texto suelto nunca guarda clienteId = 0.
    if (!(form.clienteId > 0)) { setError("Selecciona un cliente de la lista o crea uno nuevo."); return; }
    if (!(Number(form.tarifaCotizada) > 0)) { setError("La tarifa cotizada debe ser mayor a cero."); return; }
    // Filas sin tocar (todas vacías) se descartan solas; una fila con algún dato exige precio > 0, igual que la línea principal.
    const lineasAdicionales = form.lineasAdicionales
      .filter((l) => l.origenTexto.trim() || l.destinoTexto.trim() || l.unidadDescripcion.trim() || l.tarifaCotizada.trim())
      .map((l) => ({
        origenTexto: l.origenTexto.trim() || null,
        destinoTexto: l.destinoTexto.trim() || null,
        unidadDescripcion: l.unidadDescripcion.trim() || null,
        tarifaCotizada: Number(l.tarifaCotizada),
      }));
    if (lineasAdicionales.some((l) => !(l.tarifaCotizada > 0))) { setError("Cada ruta adicional debe tener un precio mayor a cero."); return; }
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
      servicioRefrigerado: form.servicioRefrigerado,
      kmIncluidos: form.kmIncluidos === "" ? null : Number(form.kmIncluidos),
      tarifaKmAdicional: form.tarifaKmAdicional === "" ? null : Number(form.tarifaKmAdicional),
      condicionesAdicionales: form.condicionesAdicionales.trim() || null,
      observaciones: form.observaciones.trim() || null,
      documentoEmisor: form.documentoEmisor,
      mensajeComercial: form.mensajeComercial.trim() || null,
      atencionNombre: form.atencionNombre.trim() || null,
      atencionCargo: form.atencionCargo.trim() || null,
      unidadDescripcion: form.unidadDescripcion.trim() || null,
      // Siempre se manda: en editar, reemplaza por completo las líneas adicionales guardadas
      // (incluido vaciarlas si el usuario quitó todas); en crear, [] equivale a no mandarlo.
      lineasAdicionales,
      // Solo viaja si hay un cálculo vigente que el usuario quiere registrar; el servidor lo RECALCULA.
      ...(costeoPayload ? { costeo: costeoPayload } : {}),
    };
    const url = editandoId ? `/api/empresas/${slug}/tms/cotizaciones/${editandoId}` : `/api/empresas/${slug}/tms/cotizaciones`;
    const res = await fetch(url, { method: editandoId ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setError(data.error ?? "No se pudo guardar."); return; }
    setMsg(data.mensaje ?? "Guardado.");
    setCosteoPayload(null);
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
        <div className="min-w-[260px]">
          <ClienteSearch slug={slug} label="Filtrar cotizaciones por cliente" valueNombre={fClienteNombre} valueId={fClienteId}
            descripcion="Busca por nombre, código, NIT o teléfono para filtrar la lista"
            mensajeSinSeleccion="Selecciona un cliente de la lista para filtrar."
            onChange={({ clienteId, clienteNombre }) => { setFClienteId(clienteId); setFClienteNombre(clienteNombre); }}
            onLimpiar={() => { setFClienteId(0); setFClienteNombre(""); }} limpiarAriaLabel="Limpiar filtro de cliente"
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
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">A. Cliente y ruta</p>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
            <ClienteSearch slug={slug} label="Cliente de la cotización" valueNombre={form.clienteNombre} valueId={form.clienteId}
              mensajeSinSeleccion="Selecciona un cliente de la lista o crea uno nuevo."
              onChange={({ clienteId, clienteNombre }) => setForm((f) => ({ ...f, clienteId, clienteNombre }))}
              inputClassName={`${inputCls} w-full`} />
            <div>
              <RutaSelect slug={slug} clienteId={form.clienteId} value={form.rutaCodigo} inputClassName={`${inputCls} w-full`}
                label="Ruta (opcional — sugiere tarifa/origen/destino)"
                descripcion="Al elegir una ruta se sugieren tarifa, origen y destino; puedes ajustarlos."
                onSeleccionar={aplicarRuta} />
              <button type="button" className="mt-1 text-[10px] text-[var(--accent)]" onClick={() => setForm((f) => ({ ...f, rutaId: null, rutaCodigo: "" }))}>Usar sin guardar como ruta</button>
            </div>
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
          </div>
          <CotizacionCatalogosRapidos slug={slug} clienteId={form.clienteId} puedeCrearCliente={permisosRapidos.clientes} puedeCrearRuta={permisosRapidos.rutas}
            onCliente={(c) => setForm((f) => ({ ...f, clienteId: c.id, clienteNombre: c.nombre }))} onRuta={aplicarRuta} />

          <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Rutas adicionales (opcional)</p>
          <p className="text-[10px] text-[var(--muted)]">
            La ruta de arriba (Origen/Destino/Unidad/Tarifa cotizada) siempre es la línea 1 del PDF. Agrega aquí más destinos de la misma propuesta — cada uno con su propio precio.
          </p>
          <div className="space-y-2">
            {form.lineasAdicionales.map((l, i) => (
              <div key={i} className="grid grid-cols-1 gap-2 rounded border border-[var(--border)] p-2 md:grid-cols-5">
                <label className="text-xs text-[var(--muted)]">Punto de carga
                  <input className={`${inputCls} mt-0.5 w-full`} value={l.origenTexto} onChange={(e) => actualizarLinea(i, { origenTexto: e.target.value })} />
                </label>
                <label className="text-xs text-[var(--muted)]">Punto de descarga
                  <input className={`${inputCls} mt-0.5 w-full`} value={l.destinoTexto} onChange={(e) => actualizarLinea(i, { destinoTexto: e.target.value })} />
                </label>
                <label className="text-xs text-[var(--muted)]">Unidad
                  <input className={`${inputCls} mt-0.5 w-full`} value={l.unidadDescripcion} onChange={(e) => actualizarLinea(i, { unidadDescripcion: e.target.value })} />
                </label>
                <label className="text-xs text-[var(--muted)]">Precio (Q)
                  <input type="number" min="0.01" step="0.01" className={`${inputCls} mt-0.5 w-full`} value={l.tarifaCotizada} onChange={(e) => actualizarLinea(i, { tarifaCotizada: e.target.value })} />
                </label>
                <div className="flex items-end">
                  <button type="button" className="rounded border border-[var(--border)] px-2 py-1 text-xs text-red-300" onClick={() => quitarLinea(i)}>Quitar ruta</button>
                </div>
              </div>
            ))}
            <button type="button" className="rounded border border-[var(--border)] px-2 py-1 text-xs text-[var(--accent)]" onClick={agregarLinea}>+ Agregar ruta</button>
          </div>

          <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">B. Presentación comercial</p>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
            <label className="text-xs text-[var(--muted)]">Documento emitido por
              <select className={`${inputCls} mt-0.5 w-full`} value={form.documentoEmisor}
                onChange={(e) => {
                  const marca = e.target.value as DocumentoEmisor;
                  setForm((f) => ({
                    ...f,
                    documentoEmisor: marca,
                    // Silencioso SOLO si el usuario nunca tocó el mensaje a mano; si ya lo editó
                    // (o cargó una cotización guardada), no se pisa — ver el aviso más abajo.
                    mensajeComercial: mensajeTocado ? f.mensajeComercial : (presentacion?.[marca]?.mensaje ?? f.mensajeComercial),
                  }));
                }}>
                {DOCUMENTOS_EMISOR.map((d) => <option key={d} value={d}>{MARCAS_DOCUMENTO[d].etiqueta}</option>)}
              </select>
            </label>
            <label className="text-xs text-[var(--muted)]">Atención a (opcional)
              <input maxLength={160} className={`${inputCls} mt-0.5 w-full`} value={form.atencionNombre} onChange={(e) => setForm((f) => ({ ...f, atencionNombre: e.target.value }))} />
            </label>
            <label className="text-xs text-[var(--muted)]">Cargo / referencia (opcional)
              <input maxLength={160} className={`${inputCls} mt-0.5 w-full`} value={form.atencionCargo} onChange={(e) => setForm((f) => ({ ...f, atencionCargo: e.target.value }))} />
            </label>
            <label className="text-xs text-[var(--muted)]">Unidad
              <input maxLength={160} placeholder="Ej. Camión 5 toneladas" className={`${inputCls} mt-0.5 w-full`} value={form.unidadDescripcion} onChange={(e) => setForm((f) => ({ ...f, unidadDescripcion: e.target.value }))} />
            </label>
            <label className="text-xs text-[var(--muted)] md:col-span-3">Mensaje para el cliente
              <textarea rows={3} maxLength={2000} className={`${inputCls} mt-0.5 w-full`} value={form.mensajeComercial}
                onChange={(e) => { setMensajeTocado(true); setForm((f) => ({ ...f, mensajeComercial: e.target.value })); }} />
              {mensajeTocado && presentacion && presentacion[form.documentoEmisor]?.mensaje.trim() !== form.mensajeComercial.trim() ? (
                <span className="mt-0.5 block text-[10px] text-amber-300/90">
                  Se aplicaría el mensaje predeterminado de {MARCAS_DOCUMENTO[form.documentoEmisor].etiqueta}: “{presentacion[form.documentoEmisor].mensaje}”{" "}
                  <button type="button" className="text-[var(--accent)] underline" onClick={() => setForm((f) => ({ ...f, mensajeComercial: presentacion[f.documentoEmisor]?.mensaje ?? "" }))}>
                    Usar este mensaje
                  </button>
                </span>
              ) : (
                <span className="mt-0.5 block text-[10px]">Va tal cual en el PDF; se guarda con la cotización (un cambio futuro del mensaje predeterminado en Ajustes no la modifica).</span>
              )}
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
          <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">C. Condiciones de servicio</p>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={form.pilotoIncluido} onChange={(e) => setForm((f) => ({ ...f, pilotoIncluido: e.target.checked }))} /> Piloto incluido</label>
            <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={form.gpsIncluido} onChange={(e) => setForm((f) => ({ ...f, gpsIncluido: e.target.checked }))} /> GPS</label>
            <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={form.seguroMercaderiaIncluido} onChange={(e) => setForm((f) => ({ ...f, seguroMercaderiaIncluido: e.target.checked }))} /> Seguro de mercadería</label>
            <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={form.seguroTercerosIncluido} onChange={(e) => setForm((f) => ({ ...f, seguroTercerosIncluido: e.target.checked }))} /> Seguro contra terceros</label>
            <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={form.servicioRefrigerado} onChange={(e) => setForm((f) => ({ ...f, servicioRefrigerado: e.target.checked }))} /> Servicio refrigerado</label>
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
          <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">D. Costeo interno</p>
          <CotizacionCosteoPanel
            key={editandoId ?? "nueva"}
            slug={slug}
            config={costeoConfig}
            fechaEmision={form.fechaEmision}
            tarifaCotizada={form.tarifaCotizada}
            incluyeIva={form.incluyeIva}
            servicioRefrigerado={form.servicioRefrigerado}
            cotizacionId={editandoId}
            editable
            onPayloadGuardar={setCosteoPayload}
            onUsarPrecioSugerido={(precio) => setForm((f) => aplicarPrecioSugerido(f, precio))}
            onPerfilElegido={(nombre) => setForm((f) => (f.unidadDescripcion.trim() ? f : { ...f, unidadDescripcion: nombre }))}
          />
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
                <a href={`/api/empresas/${slug}/tms/cotizaciones/${c.id}/pdf`} className="rounded border border-[var(--border)] px-2 py-1">PDF comercial</a>
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
                <div><span className="text-[var(--muted)]">Documento emitido por:</span> {MARCAS_DOCUMENTO[c.documentoEmisor]?.nombre ?? c.documentoEmisor}</div>
                <div><span className="text-[var(--muted)]">Atención:</span> {[c.atencionNombre, c.atencionCargo].filter(Boolean).join(" · ") || "—"}</div>
                <div><span className="text-[var(--muted)]">Unidad:</span> {c.unidadDescripcion ?? "—"}</div>
                {c.lineasAdicionales?.length ? (
                  <div className="md:col-span-3">
                    <span className="text-[var(--muted)]">Rutas adicionales:</span>
                    <ul className="ml-4 list-disc">
                      {c.lineasAdicionales.map((l) => (
                        <li key={l.id}>{l.origenTexto ?? "—"} → {l.destinoTexto ?? "—"} · {l.unidadDescripcion ?? "—"} · {money(l.tarifaCotizada)}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                <div className="md:col-span-3"><span className="text-[var(--muted)]">Mensaje al cliente:</span> {c.mensajeComercial ?? "(predeterminado de la marca)"}</div>
                <div><span className="text-[var(--muted)]">Tarifa referencia:</span> {money(c.tarifaReferencia)}</div>
                <div><span className="text-[var(--muted)]">Vigencia:</span> {c.fechaVencimiento ?? "—"}</div>
                <div><span className="text-[var(--muted)]">Piloto incluido:</span> {c.pilotoIncluido ? "Sí" : "No"}</div>
                <div><span className="text-[var(--muted)]">GPS:</span> {c.gpsIncluido ? "Sí" : "No"}</div>
                <div><span className="text-[var(--muted)]">Seguro mercadería:</span> {c.seguroMercaderiaIncluido ? "Sí" : "No"}</div>
                <div><span className="text-[var(--muted)]">Seguro terceros:</span> {c.seguroTercerosIncluido ? "Sí" : "No"}</div>
                <div><span className="text-[var(--muted)]">Servicio refrigerado:</span> {c.servicioRefrigerado ? "Sí" : "No"}</div>
                <div><span className="text-[var(--muted)]">Km incluidos:</span> {c.kmIncluidos ?? "—"}</div>
                <div><span className="text-[var(--muted)]">Tarifa km adicional:</span> {money(c.tarifaKmAdicional)}</div>
                {c.condicionesAdicionales ? <div className="md:col-span-3"><span className="text-[var(--muted)]">Condiciones:</span> {c.condicionesAdicionales}</div> : null}
                {c.observaciones ? <div className="md:col-span-3"><span className="text-[var(--muted)]">Observaciones:</span> {c.observaciones}</div> : null}
                {costeoConfig.estado === "listo" ? <CosteoRegistradoDetalle slug={slug} cotizacionId={c.id} /> : null}
              </div>
            ) : null}
          </div>
        ))}
        {!cotizaciones.length && !loading ? <p className="text-[var(--muted)]">Sin cotizaciones con este filtro.</p> : null}
      </div>
    </div>
  );
}
