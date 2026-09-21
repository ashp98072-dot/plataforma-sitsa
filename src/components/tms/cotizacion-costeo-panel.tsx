"use client";
import { useEffect, useState } from "react";
import type { ResultadoCosteoServicio } from "@/lib/tms/cotizacion-costeo";
import {
  COSTEO_FORM_VACIO, aplicarPerfilCosteo, componentesVisibles, construirPayloadCosteo, huellaCosteo, monedaCosteo, porcentajeCosteo,
  resumenDesdeResultado, type CosteoFormState, type PayloadCosteoCliente, type PerfilOpcion, type ResumenCosteoDatos,
} from "@/lib/tms/cotizacion-costeo-ui";

/**
 * COTIZACIONES-COSTEO (Fase 3) — sección INTERNA y confidencial del
 * formulario de Cotizaciones. El backend es la autoridad: si el endpoint
 * de configuración responde 403 la sección no se muestra y el resto de
 * Cotizaciones funciona igual (sin error global). Todo cálculo lo hace el
 * servidor; aquí solo se capturan datos operativos y se muestra el resultado.
 */

export type ConfigCosteo =
  | { estado: "cargando" }
  | { estado: "sin-permiso" }
  | { estado: "error"; mensaje: string }
  | { estado: "listo"; perfiles: PerfilOpcion[]; margenObjetivo: number | null; vigenteDesde: string };

const inputCls = "rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1.5 text-sm";

/** YYYY-MM-DD y una fecha real (no 2026-02-31). Mismo criterio que el servidor antes de consultar vigencias. */
export function fechaEmisionValida(fecha: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return false;
  const d = new Date(`${fecha}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === fecha;
}

/**
 * Carga la configuración de la MISMA vigencia que usará el cálculo real: la
 * de `fechaEmision` (GET .../costeo/config?fecha=YYYY-MM-DD). Al cambiar la
 * fecha se vuelve a consultar y la vigencia/margen mostrados son los de esa
 * fecha; mientras llega la respuesta se conserva la configuración anterior
 * (sin ocultar la sección) y una respuesta obsoleta se aborta. Con una fecha
 * inválida (p. ej. un <input type=date> a medio escribir) NO se hace ninguna
 * petición. 401/403 => "sin-permiso" (la sección se oculta; nunca es un error
 * global del módulo).
 */
export function useCosteoConfig(slug: string, fechaEmision: string): ConfigCosteo {
  const [config, setConfig] = useState<ConfigCosteo>({ estado: "cargando" });
  useEffect(() => {
    if (!fechaEmisionValida(fechaEmision)) return;
    const controller = new AbortController();
    fetch(`/api/empresas/${slug}/tms/cotizaciones/costeo/config?fecha=${encodeURIComponent(fechaEmision)}`, { cache: "no-store", signal: controller.signal })
      .then(async (res) => ({ status: res.status, ok: res.ok, data: await res.json().catch(() => ({})) }))
      .then(({ status, ok, data }) => {
        if (controller.signal.aborted) return;
        if (status === 401 || status === 403) setConfig({ estado: "sin-permiso" });
        else if (!ok) setConfig({ estado: "error", mensaje: data.error ?? "No se pudo cargar la configuración del costeo." });
        else setConfig({ estado: "listo", perfiles: data.perfiles ?? [], margenObjetivo: data.parametros?.margenObjetivo ?? null, vigenteDesde: data.parametros?.vigenteDesde ?? "" });
      })
      .catch(() => { if (!controller.signal.aborted) setConfig({ estado: "error", mensaje: "No se pudo cargar la configuración del costeo." }); });
    return () => controller.abort();
  }, [slug, fechaEmision]);
  return config;
}

// ---------------------------------------------------------------------------

/** Resumen + detalle (mismo aspecto para un cálculo nuevo y para un snapshot registrado). */
export function ResumenCosteo({ datos }: { datos: ResumenCosteoDatos }) {
  const filas: [string, string][] = [
    ["Costo operativo", monedaCosteo(datos.costoOperativo)],
    ["IVA costo", monedaCosteo(datos.iva)],
    ["Costo con IVA", monedaCosteo(datos.costoConIva)],
    ["Margen objetivo", porcentajeCosteo(datos.margenObjetivo)],
    ["Precio sugerido", monedaCosteo(datos.precioSugerido)],
    ["Tarifa comercial", monedaCosteo(datos.precioVenta)],
    ["Utilidad estimada", monedaCosteo(datos.utilidadEstimada)],
    ["Margen sobre costo", porcentajeCosteo(datos.margenReal)],
  ];
  return (
    <div className="space-y-3 text-xs">
      <div>
        <p className="mb-1 font-semibold uppercase tracking-wide text-[var(--muted)]">Resumen de costeo</p>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 md:grid-cols-4">
          {filas.map(([etiqueta, valor]) => (
            <div key={etiqueta}><dt className="text-[var(--muted)]">{etiqueta}</dt><dd className="font-medium">{valor}</dd></div>
          ))}
        </dl>
        <p className="mt-1 text-[var(--muted)]">La tarifa comercial es el total con IVA de la cotización; el IVA del costo es interno y no se mezcla con el de la tarifa.</p>
      </div>
      <div>
        <p className="mb-1 font-semibold uppercase tracking-wide text-[var(--muted)]">Detalle del costo</p>
        <ul className="grid grid-cols-1 gap-x-6 gap-y-0.5 md:grid-cols-2">
          {componentesVisibles(datos.componentes).map((c) => (
            <li key={c.clave} className="flex justify-between gap-2 border-b border-[var(--border)]/50"><span>{c.concepto}</span><span>{monedaCosteo(c.monto)}</span></li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

type SnapshotResumen = ResumenCosteoDatos & { perfilNombre: string; motorVersion: string; creadoEn: string | null };
type Calculado = { datos: ResumenCosteoDatos; huella: string };

export type CotizacionCosteoPanelProps = {
  slug: string;
  config: ConfigCosteo;
  fechaEmision: string;
  tarifaCotizada: string;
  incluyeIva: boolean;
  /** Condición comercial; solo sugiere refrigeración al elegir perfil. */
  servicioRefrigerado?: boolean;
  /** Cotización que se edita (null = alta): permite detectar un snapshot ya registrado (inmutable). */
  cotizacionId: number | null;
  /** Solo un Borrador (o un alta) permite aplicar el precio sugerido. */
  editable: boolean;
  /** Payload a enviar al guardar la cotización (solo si hay un cálculo vigente y el usuario quiere registrarlo); null en caso contrario. */
  onPayloadGuardar: (payload: PayloadCosteoCliente | null) => void;
  /** Acción EXPLÍCITA del usuario: el padre pone tarifaCotizada = precio y incluyeIva = true. */
  onUsarPrecioSugerido: (precio: number) => void;
};

export function CotizacionCosteoPanel(p: CotizacionCosteoPanelProps) {
  const [form, setForm] = useState<CosteoFormState>(COSTEO_FORM_VACIO);
  const [calculado, setCalculado] = useState<Calculado | null>(null);
  const [calculando, setCalculando] = useState(false);
  const [errorCalculo, setErrorCalculo] = useState("");
  const [registrar, setRegistrar] = useState(true);
  const [snapshot, setSnapshot] = useState<SnapshotResumen | null | undefined>(undefined);

  const perfiles = p.config.estado === "listo" ? p.config.perfiles : [];
  const perfil = perfiles.find((x) => x.id === form.perfilId) ?? null;
  const construido = construirPayloadCosteo(form);
  const huellaActual = construido.ok ? huellaCosteo(construido.payload, { fechaEmision: p.fechaEmision, tarifaCotizada: p.tarifaCotizada, incluyeIva: p.incluyeIva }) : null;
  const vigente = calculado != null && huellaActual === calculado.huella;
  const payloadGuardar = vigente && registrar && construido.ok && !snapshot ? construido.payload : null;
  const payloadJson = payloadGuardar ? JSON.stringify(payloadGuardar) : "";

  // Avisa al padre qué costeo (si alguno) debe viajar al guardar. Solo cambia cuando cambia el payload vigente.
  useEffect(() => { p.onPayloadGuardar(payloadJson ? (JSON.parse(payloadJson) as PayloadCosteoCliente) : null); }, [payloadJson]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cotización existente: ¿ya tiene costeo? (inmutable: 200 => solo lectura; 404 => se puede registrar uno).
  useEffect(() => {
    if (p.cotizacionId == null || p.config.estado !== "listo") return;
    const controller = new AbortController();
    fetch(`/api/empresas/${p.slug}/tms/cotizaciones/${p.cotizacionId}/costeo`, { cache: "no-store", signal: controller.signal })
      .then(async (res) => ({ ok: res.ok, data: await res.json().catch(() => ({})) }))
      .then(({ ok, data }) => { if (!controller.signal.aborted) setSnapshot(ok ? snapshotResumen(data.costeo) : null); })
      .catch(() => { if (!controller.signal.aborted) setSnapshot(null); });
    return () => controller.abort();
  }, [p.slug, p.cotizacionId, p.config.estado]);

  if (p.config.estado === "cargando" || p.config.estado === "sin-permiso") return null;
  const claseSeccion = "space-y-3 rounded-lg border border-amber-500/50 bg-amber-500/5 p-3";
  const encabezado = (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-sm font-semibold">Costeo interno</p>
      <span className="rounded bg-amber-500/20 px-2 py-0.5 text-[11px] font-semibold uppercase text-amber-300">Confidencial · no aparece en el PDF ni en el listado</span>
    </div>
  );
  if (p.config.estado === "error") return <section aria-label="Costeo interno" className={claseSeccion}>{encabezado}<p role="alert" className="text-xs text-red-300">{p.config.mensaje}</p></section>;

  if (snapshot) {
    return (
      <section aria-label="Costeo interno" className={claseSeccion}>
        {encabezado}
        <p role="status" className="text-xs text-amber-200">Esta cotización ya tiene un costeo registrado. Es un registro histórico inmutable; para recostear, duplica la cotización.</p>
        <p className="text-xs text-[var(--muted)]">Perfil {snapshot.perfilNombre} · motor {snapshot.motorVersion}{snapshot.creadoEn ? ` · ${snapshot.creadoEn}` : ""}</p>
        <ResumenCosteo datos={snapshot} />
      </section>
    );
  }

  const set = (patch: Partial<CosteoFormState>) => { setForm((f) => ({ ...f, ...patch })); };
  const num = (etiqueta: string, clave: keyof CosteoFormState, opts: { min?: string; step?: string; placeholder?: string } = {}) => (
    <label className="text-xs text-[var(--muted)]">{etiqueta}
      <input type="number" min={opts.min ?? "0"} step={opts.step ?? "any"} placeholder={opts.placeholder} className={`${inputCls} mt-0.5 w-full`}
        value={String(form[clave])} onChange={(e) => set({ [clave]: e.target.value } as Partial<CosteoFormState>)} />
    </label>
  );

  async function calcular(sobre?: { tarifaCotizada: string; incluyeIva: boolean }) {
    setErrorCalculo("");
    const c = construirPayloadCosteo(form);
    if (!c.ok) { setErrorCalculo(c.error); return; }
    const tarifa = sobre?.tarifaCotizada ?? p.tarifaCotizada;
    const iva = sobre?.incluyeIva ?? p.incluyeIva;
    setCalculando(true);
    try {
      const body: Record<string, unknown> = { ...c.payload, fechaEmision: p.fechaEmision };
      if (Number(tarifa) > 0) { body.tarifaCotizada = Number(tarifa); body.incluyeIva = iva; }
      const res = await fetch(`/api/empresas/${p.slug}/tms/cotizaciones/costeo/calcular`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setCalculado(null); setErrorCalculo(data.error ?? "No se pudo calcular el costeo."); return; }
      setCalculado({ datos: resumenDesdeResultado(data.resultado as ResultadoCosteoServicio), huella: huellaCosteo(c.payload, { fechaEmision: p.fechaEmision, tarifaCotizada: tarifa, incluyeIva: iva }) });
    } finally {
      setCalculando(false);
    }
  }

  function usarPrecioSugerido() {
    if (!calculado || !p.editable) return;
    const precio = Math.round(calculado.datos.precioSugerido * 100) / 100;
    p.onUsarPrecioSugerido(precio);
    void calcular({ tarifaCotizada: precio.toFixed(2), incluyeIva: true });
  }

  return (
    <section aria-label="Costeo interno" className={claseSeccion}>
      {encabezado}
      {p.config.vigenteDesde ? <p className="text-[11px] text-[var(--muted)]">Parámetros vigentes desde {p.config.vigenteDesde}. Los define el servidor; no se editan aquí.</p> : null}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <label className="col-span-2 text-xs text-[var(--muted)]">Perfil de unidad
          <select className={`${inputCls} mt-0.5 w-full`} value={form.perfilId} onChange={(e) => {
            const elegido = perfiles.find((x) => x.id === Number(e.target.value)) ?? null;
            setForm((f) => {
              const siguiente = aplicarPerfilCosteo(f, elegido);
              return p.servicioRefrigerado && elegido?.costoRefrigeracion ? { ...siguiente, usarRefrigeracion: true } : siguiente;
            });
          }}>
            <option value={0}>Selecciona…</option>
            {perfiles.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
          </select>
        </label>
        {num("Distancia (km)", "distanciaKm")}
        {num("Días de servicio", "diasServicio", { min: "0.01" })}
        {num("Pilotos", "cantidadPilotos")}
        {num("Auxiliares", "cantidadAuxiliares")}
        {num("Guías", "cantidadGuias")}
        {num("Seguro de mercadería (Q)", "seguroMercaderia", { placeholder: "0" })}
      </div>
      <div className="flex flex-wrap gap-4 text-xs">
        <label className="flex items-center gap-2"><input type="checkbox" checked={form.incluirGps} onChange={(e) => set({ incluirGps: e.target.checked })} /> Incluir GPS</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={form.incluirSeguroVehiculo} onChange={(e) => set({ incluirSeguroVehiculo: e.target.checked })} /> Incluir seguro del vehículo</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={form.usarRefrigeracion} disabled={!perfil?.costoRefrigeracion} onChange={(e) => set({ usarRefrigeracion: e.target.checked })} /> Usar refrigeración</label>
      </div>
      {p.servicioRefrigerado && perfil && !perfil.costoRefrigeracion ? <p role="alert" className="text-xs text-amber-300">El servicio está marcado como refrigerado, pero este perfil no tiene refrigeración configurada. Selecciona otro perfil o corrige la configuración antes de calcular.</p> : null}
      <p className="text-[11px] text-[var(--muted)]">Overrides opcionales (monto TOTAL del servicio; vacío = cálculo automático):</p>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {num("Viático piloto total (Q)", "viaticoPilotoTotal")}
        {num("Viático auxiliar total (Q)", "viaticoAuxiliarTotal")}
        {num("Viático guía total (Q)", "viaticoGuiaTotal")}
        {num("Hotel total (Q)", "hotelTotal")}
      </div>
      <div className="space-y-1">
        <p className="text-xs text-[var(--muted)]">Otros costos</p>
        {form.otrosCostos.map((o, i) => (
          <div key={i} className="grid grid-cols-[1fr_8rem_auto] gap-2">
            <input className={inputCls} placeholder="Concepto (p. ej. Peaje)" value={o.concepto} onChange={(e) => set({ otrosCostos: form.otrosCostos.map((x, j) => (j === i ? { ...x, concepto: e.target.value } : x)) })} />
            <input type="number" min="0" step="any" className={inputCls} placeholder="Monto (Q)" value={o.monto} onChange={(e) => set({ otrosCostos: form.otrosCostos.map((x, j) => (j === i ? { ...x, monto: e.target.value } : x)) })} />
            <button type="button" className="text-red-400" onClick={() => set({ otrosCostos: form.otrosCostos.filter((_, j) => j !== i) })}>Quitar</button>
          </div>
        ))}
        <button type="button" className="rounded border border-[var(--border)] px-2 py-1 text-xs" onClick={() => set({ otrosCostos: [...form.otrosCostos, { concepto: "", monto: "" }] })}>+ Agregar otro costo</button>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-[var(--muted)]">Margen objetivo (%)
          <input type="number" min="0" step="any" className={`${inputCls} mt-0.5 w-32 block`} placeholder={p.config.margenObjetivo != null ? String(p.config.margenObjetivo * 100) : "0"}
            value={form.margenObjetivoPct} onChange={(e) => set({ margenObjetivoPct: e.target.value })} />
        </label>
        <button type="button" disabled={calculando} onClick={() => void calcular()} className="rounded bg-[var(--accent)] px-3 py-1.5 text-sm text-white disabled:opacity-50">{calculando ? "Calculando…" : "Calcular costeo"}</button>
      </div>
      {errorCalculo ? <p role="alert" className="text-xs text-red-300">{errorCalculo}</p> : null}
      {calculado ? (
        <div className="space-y-2 border-t border-amber-500/30 pt-2">
          {!vigente ? <p role="status" className="text-xs text-amber-300">Los datos cambiaron desde el último cálculo: vuelve a calcular. Este resultado no se guardará.</p> : null}
          <ResumenCosteo datos={calculado.datos} />
          {p.tarifaCotizada && calculado.datos.precioSugerido != null ? <p className="text-xs text-[var(--muted)]">Diferencia tarifa vs. sugerido: {monedaCosteo(Number(p.tarifaCotizada) - calculado.datos.precioSugerido)}</p> : null}
          <div className="flex flex-wrap items-center gap-3 text-xs">
            {p.editable ? <button type="button" disabled={!vigente} onClick={usarPrecioSugerido} className="rounded border border-[var(--border)] px-2 py-1 disabled:opacity-50">Usar precio sugerido</button> : null}
            <label className="flex items-center gap-2"><input type="checkbox" checked={registrar} onChange={(e) => setRegistrar(e.target.checked)} /> Registrar este costeo al guardar la cotización (queda inmutable)</label>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function snapshotResumen(c: {
  perfilNombre: string; motorVersion: string; creadoEn: string | null; costoOperativo: number; iva: number; costoConIva: number; margenObjetivo: number;
  precioSugerido: number; precioVenta: number | null; utilidadEstimada: number | null; margenReal: number | null; componentes: ResumenCosteoDatos["componentes"];
}): SnapshotResumen {
  return { ...c };
}

// ---------------------------------------------------------------------------

/**
 * Consulta puntual del costeo registrado de una cotización (detalle
 * expandido). Solo se monta cuando la configuración indica permiso; el
 * backend vuelve a exigir cotizaciones_costeo:ver.
 */
export function CosteoRegistradoDetalle({ slug, cotizacionId }: { slug: string; cotizacionId: number }) {
  const [estado, setEstado] = useState<"cerrado" | "cargando" | "ausente" | "error" | "listo">("cerrado");
  const [datos, setDatos] = useState<SnapshotResumen | null>(null);
  async function cargar() {
    setEstado("cargando");
    const res = await fetch(`/api/empresas/${slug}/tms/cotizaciones/${cotizacionId}/costeo`, { cache: "no-store" }).catch(() => null);
    if (!res) { setEstado("error"); return; }
    if (res.status === 404) { setEstado("ausente"); return; }
    if (!res.ok) { setEstado("error"); return; }
    const data = await res.json().catch(() => ({}));
    setDatos(snapshotResumen(data.costeo));
    setEstado("listo");
  }
  return (
    <div className="mt-2 space-y-2 rounded border border-amber-500/40 bg-amber-500/5 p-2 text-xs md:col-span-3">
      <div className="flex items-center gap-2">
        <span className="font-semibold uppercase text-amber-300">Costeo interno</span>
        {estado === "cerrado" ? <button type="button" onClick={() => void cargar()} className="text-[var(--accent)]">Ver costeo registrado</button> : null}
        {estado === "cargando" ? <span role="status" className="text-[var(--muted)]">Cargando…</span> : null}
        {estado === "ausente" ? <span className="text-[var(--muted)]">Esta cotización no tiene costeo registrado.</span> : null}
        {estado === "error" ? <span role="alert" className="text-red-300">No se pudo cargar el costeo.</span> : null}
      </div>
      {estado === "listo" && datos ? <><p className="text-[var(--muted)]">Perfil {datos.perfilNombre} · motor {datos.motorVersion}</p><ResumenCosteo datos={datos} /></> : null}
    </div>
  );
}
