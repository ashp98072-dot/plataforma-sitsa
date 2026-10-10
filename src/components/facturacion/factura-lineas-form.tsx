"use client";

import { useCallback, useMemo, useState } from "react";
import type { LineaBorrador } from "@/components/facturacion/factura-borrador-form";
import {
  agregarLineaDescarga,
  agruparLineas,
  aEntradaServidor,
  desagruparLinea,
  firmaLineasFactura,
  lineasPorDefecto,
  moverLinea,
  quitarViajeDeLineas,
  valorLinea,
  viajesSinLinea,
  CLASIFICACIONES_LINEA,
  type ClasificacionLinea,
  type CondicionPago,
  type LineaEditable,
  type LineaFacturaEntrada,
  type ViajeBaseLinea,
} from "@/lib/facturacion/lineas-factura";
import { formatearMonto } from "@/lib/facturacion/ui-logica";

/**
 * FACT-4 — «Preparar líneas de factura». Reemplaza la tabla «un viaje = una línea»:
 *   viajes seleccionados → líneas editables/agrupables → factura.
 * La factura que se imprime muestra SIEMPRE Cantidad | Descripción | Precio unitario | Valor; los viajes de origen se
 * conservan internamente (trazabilidad) y se ven aquí como «Viajes».
 *
 * Nada de lo que se calcula aquí se envía como importe: el servidor recalcula valor, base, IVA y total. La vista previa y el
 * guardado van al mismo servidor; aquí no existe ninguna acción FEL ni contable (no genera pólizas ni asientos).
 */

export type ContextoFacturaApi = {
  fact4Disponible: boolean;
  entidades: { id: number; codigo: string; nombre: string }[];
  cuentasBancarias: { id: number; entidadId: number; entidadNombre: string; banco: string; alias: string; referencia: string | null; moneda: string }[];
  retencionIvaClientePct: number;
  puedeCambiarRetencion: boolean;
  retencionesPermitidas: number[];
};

/** Lo que ya tiene guardado un borrador que se edita. */
export type EdicionFact4 = {
  lineas: LineaFacturaEntrada[];
  entidadId: number | null;
  condicionPago: CondicionPago | null;
  cuentaBancariaId: number | null;
  retencionIvaPct: number;
};

type PreviewApi = {
  cliente: { id: number; nombre: string; nit: string | null; direccion: string | null };
  cantidadViajes: number;
  borrador: { moneda: string; porcentajeIva: number; subtotal: number; iva: number; total: number };
  lineas: { orden: number; planIds: number[]; cantidad: number; descripcion: string; precioUnitario: number; valor: number; clasificacion: ClasificacionLinea; precioIncluyeIva: boolean; base: number; iva: number; total: number }[] | null;
  condicionPago: CondicionPago | null;
  cuentaBancaria: { banco: string; alias: string; entidadNombre: string } | null;
  retencionIva: { aplicadaPct: number | null; clientePct: number | null; monto: number | null; netoCobrar: number | null };
};

type ViajePendienteApi = {
  planId: number;
  codigo: string;
  fechaPlan: string;
  placa: string | null;
  tarifaComercial: number | null;
  moneda: string;
  origen: string | null;
  destino: string | null;
};

type Props = {
  slug: string;
  clienteId: number;
  clienteNombre: string;
  /** undefined = crear (POST); número = editar ese Borrador (PATCH). */
  facturaId?: number;
  viajesIniciales: LineaBorrador[];
  contexto: ContextoFacturaApi;
  edicion?: EdicionFact4;
  numeroFacturaInicial?: string | null;
  fechaEmisionInicial?: string | null;
  observacionesInicial?: string | null;
  onGuardado: (facturaId: number) => void;
  onCancelar: () => void;
};

const inputCls = "rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1.5 text-sm text-[var(--text)]";
const linkCls = "text-xs text-[var(--accent)] hover:underline";

let claveSecuencia = 0;
const nuevaClave = (): string => `f${++claveSecuencia}`;

const aBase = (v: LineaBorrador): ViajeBaseLinea => ({
  planId: v.planId, codigo: v.codigo, fechaPlan: v.fechaPlan, origen: v.origen ?? null, destino: v.destino ?? null,
  montoAsignado: v.montoAsignado, precioIncluyeIva: v.precioIncluyeIva,
});

export function FacturaLineasForm({
  slug, clienteId, clienteNombre, facturaId, viajesIniciales, contexto, edicion,
  numeroFacturaInicial, fechaEmisionInicial, observacionesInicial, onGuardado, onCancelar,
}: Props) {
  const [viajes, setViajes] = useState<LineaBorrador[]>(viajesIniciales);
  const [lineas, setLineas] = useState<LineaEditable[]>(() =>
    edicion
      ? edicion.lineas.map((l) => ({ ...l, clave: nuevaClave() }))
      : lineasPorDefecto(viajesIniciales.map(aBase), nuevaClave),
  );
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set());
  const [aviso, setAviso] = useState("");

  const [entidadId, setEntidadId] = useState<number | null>(
    edicion?.entidadId ?? (contexto.entidades.length === 1 ? contexto.entidades[0].id : null),
  );
  const [condicionPago, setCondicionPago] = useState<CondicionPago>(edicion?.condicionPago ?? "CREDITO");
  const [cuentaBancariaId, setCuentaBancariaId] = useState<number | null>(edicion?.cuentaBancariaId ?? null);
  const [retencionIvaPct, setRetencionIvaPct] = useState<number>(edicion?.retencionIvaPct ?? contexto.retencionIvaClientePct);

  const [numeroFactura, setNumeroFactura] = useState(numeroFacturaInicial ?? "");
  const [fechaEmision, setFechaEmision] = useState(fechaEmisionInicial ?? "");
  const [observaciones, setObservaciones] = useState(observacionesInicial ?? "");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  const [mostrarAgregar, setMostrarAgregar] = useState(false);
  const [pendientesCliente, setPendientesCliente] = useState<ViajePendienteApi[]>([]);
  const [cargandoPendientes, setCargandoPendientes] = useState(false);

  const [preview, setPreview] = useState<{ datos: PreviewApi; firma: string } | null>(null);
  const [previsualizando, setPrevisualizando] = useState(false);

  const moneda = viajes[0]?.moneda ?? "GTQ";
  const planIds = useMemo(() => viajes.map((v) => v.planId), [viajes]);
  const viajesPorId = useMemo(() => new Map(viajes.map((v) => [v.planId, aBase(v)])), [viajes]);
  const codigoPorId = useMemo(() => new Map(viajes.map((v) => [v.planId, v.codigo])), [viajes]);
  const sinLinea = useMemo(() => viajesSinLinea(lineas, planIds), [lineas, planIds]);
  const totalValores = useMemo(
    () => lineas.reduce((s, l) => s + valorLinea(l.cantidad, l.precioUnitario), 0),
    [lineas],
  );

  const bancosVisibles = contexto.cuentasBancarias.filter(
    (b) => b.moneda.toUpperCase() === moneda.toUpperCase() && (entidadId == null || b.entidadId === entidadId),
  );
  const requiereEntidad = contexto.entidades.length > 1;

  const requierePreview = facturaId == null;
  const firmaActual = useMemo(
    () => [
      clienteId,
      [...planIds].sort((a, b) => a - b).join(","),
      firmaLineasFactura(aEntradaServidor(lineas)),
      entidadId ?? "-",
      condicionPago,
      condicionPago === "CONTADO" ? cuentaBancariaId ?? "-" : "-",
      retencionIvaPct,
    ].join("#"),
    [clienteId, planIds, lineas, entidadId, condicionPago, cuentaBancariaId, retencionIvaPct],
  );
  const previewVigente = preview != null && preview.firma === firmaActual;

  function editarLinea(clave: string, cambios: Partial<LineaEditable>) {
    setLineas((prev) => prev.map((l) => (l.clave === clave ? { ...l, ...cambios } : l)));
  }

  function aplicar(r: { ok: true; lineas: LineaEditable[] } | { ok: false; error: string }) {
    if (!r.ok) { setAviso(r.error); return false; }
    setAviso("");
    setLineas(r.lineas);
    return true;
  }

  function agrupar() {
    if (aplicar(agruparLineas(lineas, [...seleccion], viajesPorId, nuevaClave))) setSeleccion(new Set());
  }

  function quitarViaje(planId: number) {
    setViajes((prev) => prev.filter((v) => v.planId !== planId));
    setLineas((prev) => quitarViajeDeLineas(prev, planId));
    setSeleccion(new Set());
  }

  const cargarPendientesCliente = useCallback(async () => {
    setCargandoPendientes(true);
    try {
      const p = new URLSearchParams({ clienteId: String(clienteId), pageSize: "200" });
      const res = await fetch(`/api/empresas/${slug}/facturacion/viajes-pendientes?${p.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (res.ok) setPendientesCliente((data.viajes ?? []) as ViajePendienteApi[]);
    } finally {
      setCargandoPendientes(false);
    }
  }, [slug, clienteId]);

  function abrirAgregar() {
    setMostrarAgregar(true);
    void cargarPendientesCliente();
  }

  function agregarViaje(v: ViajePendienteApi) {
    const nuevo: LineaBorrador = {
      planId: v.planId, codigo: v.codigo, fechaPlan: v.fechaPlan, placa: v.placa, tarifaComercial: v.tarifaComercial,
      montoAsignado: v.tarifaComercial ?? 0, precioIncluyeIva: true, moneda: v.moneda, origen: v.origen, destino: v.destino,
    };
    setViajes((prev) => [...prev, nuevo]);
    setLineas((prev) => [...prev, ...lineasPorDefecto([aBase(nuevo)], nuevaClave)]);
    setPendientesCliente((prev) => prev.filter((p) => p.planId !== v.planId));
  }

  const idsEnFactura = useMemo(() => new Set(planIds), [planIds]);
  const disponiblesParaAgregar = pendientesCliente.filter((v) => !idsEnFactura.has(v.planId));

  function elegirEntidad(id: number | null) {
    setEntidadId(id);
    // Un banco de OTRA entidad deja de ser válido.
    const banco = contexto.cuentasBancarias.find((b) => b.id === cuentaBancariaId);
    if (banco && id != null && banco.entidadId !== id) setCuentaBancariaId(null);
  }

  function elegirBanco(id: number | null) {
    setCuentaBancariaId(id);
    const banco = contexto.cuentasBancarias.find((b) => b.id === id);
    if (banco) setEntidadId(banco.entidadId);
  }

  function problemaLocal(): string | null {
    if (!lineas.length) return "La factura necesita al menos una línea.";
    if (sinLinea.length) return `Hay viajes sin línea: ${sinLinea.map((id) => codigoPorId.get(id) ?? id).join(", ")}.`;
    if (lineas.some((l) => !(l.precioUnitario > 0))) return "Cada línea necesita un precio unitario mayor que cero (¿falta el de la descarga?).";
    if (lineas.some((l) => !l.descripcion.trim())) return "Cada línea necesita una descripción.";
    if (requiereEntidad && entidadId == null) return "Elige la entidad emisora.";
    if (condicionPago === "CONTADO" && cuentaBancariaId == null) return "Una factura al contado requiere la cuenta bancaria donde se recibe el pago.";
    return null;
  }

  function cuerpo() {
    return {
      clienteId,
      planes: viajes.map((v) => ({ planId: v.planId, montoAsignado: v.montoAsignado, precioIncluyeIva: true })),
      lineas: aEntradaServidor(lineas),
      entidadId,
      condicionPago,
      cuentaBancariaId: condicionPago === "CONTADO" ? cuentaBancariaId : null,
      retencionIvaPct,
    };
  }

  async function previsualizar() {
    const p = problemaLocal();
    if (p) { setError(p); return; }
    setPrevisualizando(true);
    setError("");
    const firma = firmaActual;
    try {
      const res = await fetch(`/api/empresas/${slug}/facturacion/facturas/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cuerpo()),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPreview(null);
        setError(data.error || "No se pudo generar la vista previa.");
        return;
      }
      setPreview({ datos: data as PreviewApi, firma });
    } catch {
      setError("Error de conexión.");
    } finally {
      setPrevisualizando(false);
    }
  }

  async function guardar() {
    const p = problemaLocal();
    if (p) { setError(p); return; }
    if (requierePreview && !previewVigente) { setError("Previsualiza el borrador antes de guardarlo."); return; }
    setGuardando(true);
    setError("");
    try {
      const url = facturaId != null
        ? `/api/empresas/${slug}/facturacion/facturas/${facturaId}`
        : `/api/empresas/${slug}/facturacion/facturas`;
      const res = await fetch(url, {
        method: facturaId != null ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...cuerpo(),
          numeroFactura: numeroFactura.trim() || null,
          fechaEmision: fechaEmision || null,
          observaciones: observaciones.trim() || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "No se pudo guardar el borrador.");
        return;
      }
      onGuardado(Number(data.id ?? facturaId));
    } catch {
      setError("Error de conexión.");
    } finally {
      setGuardando(false);
    }
  }

  const retencionDeshabilitada = !contexto.puedeCambiarRetencion;
  const retenciones = contexto.retencionesPermitidas.length ? contexto.retencionesPermitidas : [0, 15, 30];

  return (
    <div className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-medium text-[var(--text)]">
          {facturaId != null ? `Editar Borrador #${facturaId}` : "Nueva factura — Borrador"} · Preparar líneas de factura
        </h3>
        <span className="text-xs text-[var(--muted)]">Cliente: {clienteNombre}</span>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
          Número de factura (opcional en Borrador)
          <input className={inputCls} value={numeroFactura} onChange={(e) => setNumeroFactura(e.target.value)} maxLength={60} placeholder="Se exige al emitir" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
          Fecha de emisión (opcional en Borrador)
          <input className={inputCls} type="date" value={fechaEmision} onChange={(e) => setFechaEmision(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
          Observaciones
          <input className={inputCls} value={observaciones} onChange={(e) => setObservaciones(e.target.value)} maxLength={2000} />
        </label>
      </div>

      {/* Condición de pago, entidad y retención */}
      <div className="grid gap-2 rounded-lg border border-[var(--border)] p-3 sm:grid-cols-2 lg:grid-cols-4">
        {contexto.entidades.length ? (
          <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
            Entidad emisora
            <select
              className={inputCls}
              value={entidadId ?? ""}
              onChange={(e) => elegirEntidad(e.target.value ? Number(e.target.value) : null)}
              disabled={contexto.entidades.length === 1}
            >
              {contexto.entidades.length > 1 ? <option value="">— Elegir —</option> : null}
              {contexto.entidades.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
            </select>
          </label>
        ) : null}

        <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
          Condición de pago
          <select
            aria-label="Condición de pago"
            className={inputCls}
            value={condicionPago}
            onChange={(e) => { const c = e.target.value as CondicionPago; setCondicionPago(c); if (c === "CREDITO") setCuentaBancariaId(null); }}
          >
            <option value="CREDITO">Crédito</option>
            <option value="CONTADO">Contado</option>
          </select>
        </label>

        {condicionPago === "CONTADO" ? (
          <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
            Cuenta bancaria donde se recibe el pago
            <select
              aria-label="Cuenta bancaria"
              className={inputCls}
              value={cuentaBancariaId ?? ""}
              onChange={(e) => elegirBanco(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">— Elegir —</option>
              {bancosVisibles.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.banco} · {b.alias}{b.referencia ? ` · ${b.referencia}` : ""}{contexto.entidades.length > 1 ? ` (${b.entidadNombre})` : ""}
                </option>
              ))}
            </select>
            {!bancosVisibles.length ? (
              <span className="text-[10px] text-amber-600">No hay cuentas bancarias activas en {moneda}{entidadId != null ? " para esta entidad" : ""}. Pide a Contabilidad que las configure.</span>
            ) : null}
          </label>
        ) : null}

        <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
          Retención de IVA
          <select
            aria-label="Retención de IVA"
            className={inputCls}
            value={retencionIvaPct}
            disabled={retencionDeshabilitada}
            onChange={(e) => setRetencionIvaPct(Number(e.target.value))}
          >
            {retenciones.map((r) => <option key={r} value={r}>{r === 0 ? "No aplica (0 %)" : `${r} %`}</option>)}
          </select>
          <span className="text-[10px]">
            Configurada para el cliente: {contexto.retencionIvaClientePct} %.
            {retencionDeshabilitada ? " Cambiarla requiere el permiso «Editar requisitos de clientes»." : ""}
          </span>
        </label>
      </div>

      {/* Líneas */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={seleccion.size < 2}
          className="rounded border border-[var(--accent)] px-2.5 py-1 text-xs text-[var(--accent)] disabled:opacity-50"
          onClick={agrupar}
        >
          Agrupar en una línea{seleccion.size >= 2 ? ` (${seleccion.size})` : ""}
        </button>
        <span className="text-[11px] text-[var(--muted)]">
          Marca varias líneas para agruparlas. Tú decides cómo agrupar: no hay una regla automática.
        </span>
      </div>
      {aviso ? <p className="text-xs text-amber-600">{aviso}</p> : null}
      {sinLinea.length ? (
        <p className="text-xs text-amber-600">
          Viajes sin línea (la factura no se puede guardar así): {sinLinea.map((id) => codigoPorId.get(id) ?? id).join(", ")}.
        </p>
      ) : null}

      <div className="table-scroll rounded-lg border border-[var(--border)]">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-[var(--thead)] text-xs uppercase text-[var(--muted)]">
            <tr>
              <th className="px-2 py-1.5" />
              <th className="px-2 py-1.5">Cantidad</th>
              <th className="px-2 py-1.5">Descripción</th>
              <th className="px-2 py-1.5">Precio unitario</th>
              <th className="px-2 py-1.5 text-right">Valor</th>
              <th className="px-2 py-1.5">Tipo</th>
              <th className="px-2 py-1.5">IVA</th>
              <th className="px-2 py-1.5">Viajes</th>
              <th className="px-2 py-1.5" />
            </tr>
          </thead>
          <tbody>
            {lineas.map((l, i) => (
              <tr key={l.clave} className="border-t border-[var(--border)] align-top">
                <td className="px-2 py-1.5">
                  <input
                    type="checkbox"
                    aria-label={`Seleccionar línea ${i + 1}`}
                    checked={seleccion.has(l.clave)}
                    onChange={(e) => setSeleccion((prev) => {
                      const n = new Set(prev);
                      if (e.target.checked) n.add(l.clave); else n.delete(l.clave);
                      return n;
                    })}
                  />
                </td>
                <td className="px-2 py-1.5">
                  <input
                    type="number" step="0.01" min={0.01} aria-label={`Cantidad de la línea ${i + 1}`}
                    className={`${inputCls} w-20`}
                    value={l.cantidad}
                    onChange={(e) => editarLinea(l.clave, { cantidad: Number(e.target.value) })}
                  />
                </td>
                <td className="px-2 py-1.5">
                  <textarea
                    aria-label={`Descripción de la línea ${i + 1}`}
                    className={`${inputCls} min-w-[16rem] w-full`}
                    rows={2}
                    maxLength={500}
                    value={l.descripcion}
                    onChange={(e) => editarLinea(l.clave, { descripcion: e.target.value })}
                  />
                </td>
                <td className="px-2 py-1.5">
                  <input
                    type="number" step="0.01" min={0} aria-label={`Precio unitario de la línea ${i + 1}`}
                    className={`${inputCls} w-28`}
                    value={l.precioUnitario}
                    onChange={(e) => editarLinea(l.clave, { precioUnitario: Number(e.target.value) })}
                  />
                </td>
                <td className="whitespace-nowrap px-2 py-1.5 text-right text-xs">{formatearMonto(valorLinea(l.cantidad, l.precioUnitario), moneda)}</td>
                <td className="px-2 py-1.5">
                  <select
                    aria-label={`Clasificación de la línea ${i + 1}`}
                    className={inputCls}
                    value={l.clasificacion}
                    onChange={(e) => editarLinea(l.clave, { clasificacion: e.target.value as ClasificacionLinea })}
                  >
                    {CLASIFICACIONES_LINEA.map((c) => <option key={c} value={c}>{c === "SERVICIO" ? "Servicio" : "Bien"}</option>)}
                  </select>
                </td>
                <td className="px-2 py-1.5">
                  <select
                    aria-label={`Tratamiento de IVA de la línea ${i + 1}`}
                    className={inputCls}
                    value={l.precioIncluyeIva ? "incluido" : "agregado"}
                    onChange={(e) => editarLinea(l.clave, { precioIncluyeIva: e.target.value === "incluido" })}
                  >
                    <option value="incluido">IVA incluido</option>
                    <option value="agregado">Agregar IVA</option>
                  </select>
                </td>
                <td className="px-2 py-1.5 text-xs">
                  <span className="font-mono">{l.planIds.map((id) => codigoPorId.get(id) ?? id).join(", ")}</span>
                </td>
                <td className="whitespace-nowrap px-2 py-1.5 text-xs">
                  <div className="flex flex-wrap gap-x-2 gap-y-1">
                    <button type="button" className={linkCls} disabled={i === 0} onClick={() => setLineas((p) => moverLinea(p, l.clave, -1))} aria-label={`Subir línea ${i + 1}`}>↑</button>
                    <button type="button" className={linkCls} disabled={i === lineas.length - 1} onClick={() => setLineas((p) => moverLinea(p, l.clave, 1))} aria-label={`Bajar línea ${i + 1}`}>↓</button>
                    {l.planIds.length > 1 ? (
                      <button type="button" className={linkCls} onClick={() => aplicar(desagruparLinea(lineas, l.clave, viajesPorId, nuevaClave))}>Desagrupar</button>
                    ) : null}
                    <button type="button" className={linkCls} onClick={() => aplicar(agregarLineaDescarga(lineas, l.clave, nuevaClave))}>+ Descarga</button>
                    <button type="button" className="text-xs text-rose-500 hover:underline" onClick={() => setLineas((p) => p.filter((x) => x.clave !== l.clave))}>Quitar línea</button>
                  </div>
                </td>
              </tr>
            ))}
            {!lineas.length ? (
              <tr><td colSpan={9} className="px-3 py-4 text-center text-xs text-[var(--muted)]">Sin líneas. Agrega un viaje pendiente del cliente.</td></tr>
            ) : null}
          </tbody>
          <tfoot>
            <tr className="border-t border-[var(--border)] font-medium">
              <td colSpan={4} className="px-2 py-1.5 text-right text-xs text-[var(--muted)]">
                Suma de valores (el total con IVA se calcula en el servidor)
              </td>
              <td className="whitespace-nowrap px-2 py-1.5 text-right text-sm text-[var(--text)]">{formatearMonto(totalValores, moneda)}</td>
              <td colSpan={4} />
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Viajes de la factura (trazabilidad) */}
      <div className="rounded-lg border border-[var(--border)] p-2">
        <p className="mb-1 text-xs font-medium text-[var(--text)]">Viajes de esta factura ({viajes.length})</p>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {viajes.map((v) => (
            <li key={v.planId} className="flex items-center gap-1">
              <span className="font-mono">{v.codigo}</span>
              <span className="text-[var(--muted)]">{v.fechaPlan}{v.destino ? ` · ${v.destino}` : ""}</span>
              {viajes.length > 1 ? (
                <button type="button" className="text-rose-500 hover:underline" aria-label={`Quitar el viaje ${v.codigo}`} onClick={() => quitarViaje(v.planId)}>Quitar</button>
              ) : null}
            </li>
          ))}
        </ul>
        {mostrarAgregar ? (
          <div className="mt-2 rounded border border-[var(--border)] p-2">
            <p className="mb-1 text-xs font-medium text-[var(--text)]">Agregar viaje pendiente de este cliente</p>
            {cargandoPendientes ? (
              <p className="text-xs text-[var(--muted)]">Cargando…</p>
            ) : disponiblesParaAgregar.length ? (
              <ul className="max-h-40 space-y-1 overflow-y-auto text-xs">
                {disponiblesParaAgregar.map((v) => (
                  <li key={v.planId} className="flex items-center justify-between gap-2 border-t border-[var(--border)] pt-1 first:border-t-0 first:pt-0">
                    <span>{v.codigo} · {v.fechaPlan} · {formatearMonto(v.tarifaComercial, v.moneda)}</span>
                    <button type="button" className="text-[var(--accent)] hover:underline" onClick={() => agregarViaje(v)}>Agregar</button>
                  </li>
                ))}
              </ul>
            ) : <p className="text-xs text-[var(--muted)]">No hay más viajes pendientes de este cliente.</p>}
          </div>
        ) : (
          <button type="button" className="mt-1 text-xs text-[var(--accent)] hover:underline" onClick={abrirAgregar}>
            + Agregar otro viaje pendiente de este cliente
          </button>
        )}
      </div>

      {requierePreview && preview ? (
        <div className={`space-y-2 rounded-lg border p-3 ${previewVigente ? "border-emerald-700/50" : "border-amber-600/60"}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Vista previa del borrador</p>
            {!previewVigente ? <span className="text-xs text-amber-600">Cambiaste líneas, pago o retención: vuelve a previsualizar.</span> : null}
          </div>
          <ul className="space-y-0.5 text-xs text-[var(--text)]">
            <li>Cliente: {preview.datos.cliente.nombre}{preview.datos.cliente.nit ? ` · NIT ${preview.datos.cliente.nit}` : ""}</li>
            <li>Moneda: {preview.datos.borrador.moneda} · Viajes: {preview.datos.cantidadViajes} · Líneas: {preview.datos.lineas?.length ?? 0}</li>
            <li>
              Condición: {preview.datos.condicionPago === "CONTADO" ? "Contado" : "Crédito"}
              {preview.datos.cuentaBancaria ? ` · ${preview.datos.cuentaBancaria.banco} ${preview.datos.cuentaBancaria.alias}` : ""}
            </li>
          </ul>
          <div className="table-scroll rounded border border-[var(--border)]">
            <table className="min-w-full text-left text-xs">
              <thead className="bg-[var(--thead)] uppercase text-[var(--muted)]">
                <tr>
                  <th className="px-2 py-1">Cantidad</th>
                  <th className="px-2 py-1">Descripción</th>
                  <th className="px-2 py-1 text-right">Precio unitario</th>
                  <th className="px-2 py-1 text-right">Valor</th>
                  <th className="px-2 py-1">Tipo</th>
                  <th className="px-2 py-1 text-right">Base</th>
                  <th className="px-2 py-1 text-right">IVA</th>
                  <th className="px-2 py-1 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {(preview.datos.lineas ?? []).map((l) => (
                  <tr key={l.orden} className="border-t border-[var(--border)]">
                    <td className="px-2 py-1">{l.cantidad}</td>
                    <td className="px-2 py-1">{l.descripcion}</td>
                    <td className="whitespace-nowrap px-2 py-1 text-right">{formatearMonto(l.precioUnitario, preview.datos.borrador.moneda)}</td>
                    <td className="whitespace-nowrap px-2 py-1 text-right">{formatearMonto(l.valor, preview.datos.borrador.moneda)}</td>
                    <td className="px-2 py-1">{l.clasificacion === "BIEN" ? "Bien" : "Servicio"}</td>
                    <td className="whitespace-nowrap px-2 py-1 text-right">{formatearMonto(l.base, preview.datos.borrador.moneda)}</td>
                    <td className="whitespace-nowrap px-2 py-1 text-right">{formatearMonto(l.iva, preview.datos.borrador.moneda)}</td>
                    <td className="whitespace-nowrap px-2 py-1 text-right">{formatearMonto(l.total, preview.datos.borrador.moneda)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-[var(--border)] font-medium">
                <tr><td colSpan={7} className="px-2 py-1 text-right text-[var(--muted)]">Subtotal</td><td className="whitespace-nowrap px-2 py-1 text-right">{formatearMonto(preview.datos.borrador.subtotal, preview.datos.borrador.moneda)}</td></tr>
                <tr><td colSpan={7} className="px-2 py-1 text-right text-[var(--muted)]">IVA (suma del IVA de cada línea)</td><td className="whitespace-nowrap px-2 py-1 text-right">{formatearMonto(preview.datos.borrador.iva, preview.datos.borrador.moneda)}</td></tr>
                <tr><td colSpan={7} className="px-2 py-1 text-right text-[var(--muted)]">TOTAL</td><td className="whitespace-nowrap px-2 py-1 text-right">{formatearMonto(preview.datos.borrador.total, preview.datos.borrador.moneda)}</td></tr>
                {preview.datos.retencionIva.aplicadaPct ? (
                  <>
                    <tr><td colSpan={7} className="px-2 py-1 text-right text-[var(--muted)]">Retención de IVA ({preview.datos.retencionIva.aplicadaPct} %) — informativa</td><td className="whitespace-nowrap px-2 py-1 text-right">{formatearMonto(preview.datos.retencionIva.monto, preview.datos.borrador.moneda)}</td></tr>
                    <tr><td colSpan={7} className="px-2 py-1 text-right text-[var(--muted)]">A cobrar al cliente (total − retención)</td><td className="whitespace-nowrap px-2 py-1 text-right">{formatearMonto(preview.datos.retencionIva.netoCobrar, preview.datos.borrador.moneda)}</td></tr>
                  </>
                ) : null}
              </tfoot>
            </table>
          </div>
          <p className="text-[11px] text-[var(--muted)]">
            Es una vista previa: no se reservó ningún viaje ni se generó ningún asiento contable. La retención se congela con la factura;
            la póliza se generará después de la certificación FEL (fase posterior).
          </p>
        </div>
      ) : null}

      {error ? <p className="text-sm text-rose-500">{error}</p> : null}

      <div className="flex flex-wrap gap-2 pt-1">
        {requierePreview ? (
          <button type="button" disabled={guardando || previsualizando || !lineas.length} className="rounded-lg border border-[var(--accent)] px-3 py-1.5 text-sm text-[var(--accent)] disabled:opacity-60" onClick={() => void previsualizar()}>
            {previsualizando ? "Calculando…" : previewVigente ? "Actualizar vista previa" : "Previsualizar"}
          </button>
        ) : null}
        <button type="button" disabled={guardando || (requierePreview && !previewVigente)} className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm text-white disabled:opacity-60" onClick={() => void guardar()}>
          {guardando ? "Guardando…" : "Guardar borrador"}
        </button>
        <button type="button" disabled={guardando} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--text)]" onClick={onCancelar}>
          Cancelar
        </button>
      </div>
    </div>
  );
}
