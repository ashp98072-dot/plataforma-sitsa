"use client";

import { useCallback, useMemo, useState } from "react";
import { calcularTotalLineas, etiquetaTratamientoIva, firmaPreview, formatearMonto, lineaDifiereDeTarifa } from "@/lib/facturacion/ui-logica";

/**
 * FACT-1-UI — formulario de Borrador COMPARTIDO entre:
 *  - Fase E: crear factura Borrador (desde Viajes pendientes seleccionados).
 *  - Fase H: editar un Borrador existente (número/fecha/observaciones/
 *    viajes/montos) — nunca aplicable a Emitida/Anulada, el caller decide
 *    cuándo mostrar este componente.
 *
 * NUNCA envía monto_total ni base/IVA — el backend los calcula server-side
 * (crearFactura/actualizarFacturaBorrador en src/lib/facturacion/facturas.ts).
 * FACT-2: al CREAR hay un paso de «Previsualizar» (POST .../facturas/preview,
 * sin escritura) y «Guardar borrador» solo se habilita con una vista previa
 * vigente. Al EDITAR el flujo no cambia. Aquí no existe ninguna acción FEL.
 *
 * TRATAMIENTO DE IVA POR VIAJE: cada línea tiene su propio selector («IVA incluido» / «Agregar IVA»). Se muestra
 * preseleccionado «IVA incluido» (el caso más común) y se puede cambiar viaje por viaje: una misma factura puede
 * mezclarlos. Cambiar el de CUALQUIER viaje invalida la vista previa. Nada se infiere del cliente, la ruta ni la tarifa.
 */

export type LineaBorrador = {
  planId: number;
  codigo: string;
  fechaPlan: string;
  placa: string | null;
  tarifaComercial: number | null;
  montoAsignado: number;
  /** Tratamiento de IVA de ESTA línea: true = ya incluido en la tarifa; false = se agrega. */
  precioIncluyeIva: boolean;
  moneda?: string;
};

type PreviewApi = {
  cliente: { id: number; nombre: string; nit: string | null; direccion: string | null };
  cantidadViajes: number;
  borrador: {
    moneda: string;
    porcentajeIva: number;
    lineas: { planId: number; codigo: string; fechaPlan: string; descripcion: string; montoAsignado: number; precioIncluyeIva: boolean; base: number; iva: number; total: number }[];
    subtotal: number;
    iva: number;
    total: number;
  };
};

type ViajePendienteApi = {
  planId: number;
  codigo: string;
  fechaPlan: string;
  // HOTFIX PRE-MERGE PR #114 (Hallazgo 1): el backend garantiza
  // cli.id IS NOT NULL — nunca null aquí.
  clienteId: number;
  cliente: string;
  placa: string | null;
  tarifaComercial: number | null;
  cerradoEn: string | null;
  moneda: string;
};

type Props = {
  slug: string;
  clienteId: number;
  clienteNombre: string;
  /** undefined = crear (POST); número = editar ese Borrador (PATCH). */
  facturaId?: number;
  lineasIniciales: LineaBorrador[];
  numeroFacturaInicial?: string | null;
  fechaEmisionInicial?: string | null;
  observacionesInicial?: string | null;
  onGuardado: (facturaId: number) => void;
  onCancelar: () => void;
};

const inputCls = "rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1.5 text-sm text-[var(--text)]";

export function FacturaBorradorForm({
  slug, clienteId, clienteNombre, facturaId, lineasIniciales,
  numeroFacturaInicial, fechaEmisionInicial, observacionesInicial,
  onGuardado, onCancelar,
}: Props) {
  const [lineas, setLineas] = useState<LineaBorrador[]>(lineasIniciales);
  const [numeroFactura, setNumeroFactura] = useState(numeroFacturaInicial ?? "");
  const [fechaEmision, setFechaEmision] = useState(fechaEmisionInicial ?? "");
  const [observaciones, setObservaciones] = useState(observacionesInicial ?? "");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  const [mostrarAgregar, setMostrarAgregar] = useState(false);
  const [pendientesCliente, setPendientesCliente] = useState<ViajePendienteApi[]>([]);
  const [cargandoPendientes, setCargandoPendientes] = useState(false);

  const total = useMemo(() => calcularTotalLineas(lineas), [lineas]);
  const monedaCodigo = lineas[0]?.moneda ?? "GTQ";

  // Vista previa (solo al crear). Su huella debe coincidir con la de las líneas actuales para poder guardar.
  const [preview, setPreview] = useState<{ datos: PreviewApi; firma: string } | null>(null);
  const [previsualizando, setPrevisualizando] = useState(false);
  const firmaActual = useMemo(() => firmaPreview({ clienteId, lineas }), [clienteId, lineas]);
  const requierePreview = facturaId == null;
  const previewVigente = preview != null && preview.firma === firmaActual;

  function setMonto(planId: number, monto: number) {
    setLineas((prev) => prev.map((l) => (l.planId === planId ? { ...l, montoAsignado: monto } : l)));
  }
  function setTratamientoIva(planId: number, precioIncluyeIva: boolean) {
    setLineas((prev) => prev.map((l) => (l.planId === planId ? { ...l, precioIncluyeIva } : l)));
  }
  function quitarLinea(planId: number) {
    setLineas((prev) => prev.filter((l) => l.planId !== planId));
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
    setLineas((prev) => [
      ...prev,
      { planId: v.planId, codigo: v.codigo, fechaPlan: v.fechaPlan, placa: v.placa, tarifaComercial: v.tarifaComercial, montoAsignado: v.tarifaComercial ?? 0, precioIncluyeIva: true, moneda: v.moneda },
    ]);
    setPendientesCliente((prev) => prev.filter((p) => p.planId !== v.planId));
  }

  const idsEnLineas = useMemo(() => new Set(lineas.map((l) => l.planId)), [lineas]);
  const disponiblesParaAgregar = pendientesCliente.filter((v) => !idsEnLineas.has(v.planId));

  async function previsualizar() {
    if (!lineas.length) { setError("Selecciona al menos un viaje."); return; }
    setPrevisualizando(true);
    setError("");
    const firma = firmaActual;
    try {
      const res = await fetch(`/api/empresas/${slug}/facturacion/facturas/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clienteId, planes: lineas.map((l) => ({ planId: l.planId, montoAsignado: l.montoAsignado, precioIncluyeIva: l.precioIncluyeIva })) }),
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
    if (!lineas.length) { setError("Selecciona al menos un viaje."); return; }
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
          clienteId,
          planes: lineas.map((l) => ({ planId: l.planId, montoAsignado: l.montoAsignado, precioIncluyeIva: l.precioIncluyeIva })),
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

  return (
    <div className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-medium text-[var(--text)]">
          {facturaId != null ? `Editar Borrador #${facturaId}` : "Nueva factura — Borrador"}
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

      <div className="table-scroll rounded-lg border border-[var(--border)]">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-[var(--thead)] text-xs uppercase text-[var(--muted)]">
            <tr>
              <th className="px-2 py-1.5">Código</th>
              <th className="px-2 py-1.5">Fecha</th>
              <th className="px-2 py-1.5">Unidad</th>
              <th className="px-2 py-1.5">Tarifa comercial</th>
              <th className="px-2 py-1.5">Monto a facturar</th>
              <th className="px-2 py-1.5">Tratamiento IVA (12 %)</th>
              <th className="px-2 py-1.5" />
            </tr>
          </thead>
          <tbody>
            {lineas.map((l) => {
              const difiere = lineaDifiereDeTarifa(l);
              return (
                <tr key={l.planId} className="border-t border-[var(--border)]">
                  <td className="px-2 py-1.5 font-mono text-xs">{l.codigo}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-xs">{l.fechaPlan}</td>
                  <td className="px-2 py-1.5 text-xs">{l.placa ?? "—"}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-xs">{formatearMonto(l.tarifaComercial, l.moneda)}</td>
                  <td className="px-2 py-1.5">
                    <input
                      type="number" step="0.01" min={0}
                      className={`${inputCls} w-28`}
                      value={l.montoAsignado}
                      onChange={(e) => setMonto(l.planId, Number(e.target.value))}
                    />
                    {difiere ? <p className="mt-0.5 text-[10px] text-amber-600">Difiere de la tarifa comercial</p> : null}
                  </td>
                  <td className="px-2 py-1.5">
                    <select
                      aria-label={`Tratamiento de IVA del viaje ${l.codigo}`}
                      className={inputCls}
                      value={l.precioIncluyeIva ? "incluido" : "agregado"}
                      onChange={(e) => setTratamientoIva(l.planId, e.target.value === "incluido")}
                    >
                      <option value="incluido">IVA incluido</option>
                      <option value="agregado">Agregar IVA</option>
                    </select>
                  </td>
                  <td className="px-2 py-1.5">
                    <button type="button" className="text-xs text-rose-500 hover:underline" onClick={() => quitarLinea(l.planId)}>Quitar</button>
                  </td>
                </tr>
              );
            })}
            {!lineas.length ? (
              <tr><td colSpan={7} className="px-3 py-4 text-center text-xs text-[var(--muted)]">Sin viajes en esta factura.</td></tr>
            ) : null}
          </tbody>
          <tfoot>
            <tr className="border-t border-[var(--border)] font-medium">
              <td colSpan={4} className="px-2 py-1.5 text-right text-xs text-[var(--muted)]">Suma de tarifas (el total con IVA se calcula en la vista previa)</td>
              <td colSpan={3} className="px-2 py-1.5 text-sm text-[var(--text)]">{formatearMonto(total, monedaCodigo)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {mostrarAgregar ? (
        <div className="rounded-lg border border-[var(--border)] p-2">
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
        <button type="button" className="text-xs text-[var(--accent)] hover:underline" onClick={abrirAgregar}>
          + Agregar otro viaje pendiente de este cliente
        </button>
      )}

      {requierePreview && preview ? (
        <div className={`space-y-2 rounded-lg border p-3 ${previewVigente ? "border-emerald-700/50" : "border-amber-600/60"}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Vista previa del borrador</p>
            {!previewVigente ? <span className="text-xs text-amber-600">Cambiaste los viajes o montos: vuelve a previsualizar.</span> : null}
          </div>
          <ul className="space-y-0.5 text-xs text-[var(--text)]">
            <li>Cliente: {preview.datos.cliente.nombre}{preview.datos.cliente.nit ? ` · NIT ${preview.datos.cliente.nit}` : ""}</li>
            <li>Moneda: {preview.datos.borrador.moneda} · Viajes: {preview.datos.cantidadViajes}</li>
            <li>IVA {preview.datos.borrador.porcentajeIva} % · cada viaje con su propio tratamiento (columna «IVA»)</li>
          </ul>
          <div className="table-scroll rounded border border-[var(--border)]">
            <table className="min-w-full text-left text-xs">
              <thead className="bg-[var(--thead)] uppercase text-[var(--muted)]">
                <tr>
                  <th className="px-2 py-1">Viaje</th>
                  <th className="px-2 py-1">Descripción</th>
                  <th className="px-2 py-1 text-right">Tarifa</th>
                  <th className="px-2 py-1">Tratamiento</th>
                  <th className="px-2 py-1 text-right">Base</th>
                  <th className="px-2 py-1 text-right">IVA</th>
                  <th className="px-2 py-1 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {preview.datos.borrador.lineas.map((l) => (
                  <tr key={l.planId} className="border-t border-[var(--border)]">
                    <td className="px-2 py-1 font-mono">{l.codigo}</td>
                    <td className="px-2 py-1">{l.descripcion}</td>
                    <td className="whitespace-nowrap px-2 py-1 text-right">{formatearMonto(l.montoAsignado, preview.datos.borrador.moneda)}</td>
                    <td className="whitespace-nowrap px-2 py-1">{etiquetaTratamientoIva(l.precioIncluyeIva)}</td>
                    <td className="whitespace-nowrap px-2 py-1 text-right">{formatearMonto(l.base, preview.datos.borrador.moneda)}</td>
                    <td className="whitespace-nowrap px-2 py-1 text-right">{formatearMonto(l.iva, preview.datos.borrador.moneda)}</td>
                    <td className="whitespace-nowrap px-2 py-1 text-right">{formatearMonto(l.total, preview.datos.borrador.moneda)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-[var(--border)] font-medium">
                <tr><td colSpan={6} className="px-2 py-1 text-right text-[var(--muted)]">Subtotal</td><td className="whitespace-nowrap px-2 py-1 text-right">{formatearMonto(preview.datos.borrador.subtotal, preview.datos.borrador.moneda)}</td></tr>
                <tr><td colSpan={6} className="px-2 py-1 text-right text-[var(--muted)]">IVA (suma del IVA de cada línea)</td><td className="whitespace-nowrap px-2 py-1 text-right">{formatearMonto(preview.datos.borrador.iva, preview.datos.borrador.moneda)}</td></tr>
                <tr><td colSpan={6} className="px-2 py-1 text-right text-[var(--muted)]">TOTAL</td><td className="whitespace-nowrap px-2 py-1 text-right">{formatearMonto(preview.datos.borrador.total, preview.datos.borrador.moneda)}</td></tr>
              </tfoot>
            </table>
          </div>
          <p className="text-[11px] text-[var(--muted)]">Es una vista previa: todavía no se reservó ningún viaje. Al guardar, el servidor vuelve a validar todo.</p>
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
