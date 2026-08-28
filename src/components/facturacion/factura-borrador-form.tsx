"use client";

import { useCallback, useMemo, useState } from "react";
import { calcularTotalLineas, lineaDifiereDeTarifa } from "@/lib/facturacion/ui-logica";

/**
 * FACT-1-UI — formulario de Borrador COMPARTIDO entre:
 *  - Fase E: crear factura Borrador (desde Viajes pendientes seleccionados).
 *  - Fase H: editar un Borrador existente (número/fecha/observaciones/
 *    viajes/montos) — nunca aplicable a Emitida/Anulada, el caller decide
 *    cuándo mostrar este componente.
 *
 * NUNCA envía monto_total — el backend lo calcula server-side sumando
 * monto_asignado (crearFactura/actualizarFacturaBorrador en
 * src/lib/facturacion/facturas.ts).
 */

export type LineaBorrador = {
  planId: number;
  codigo: string;
  fechaPlan: string;
  placa: string | null;
  tarifaComercial: number | null;
  montoAsignado: number;
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

function moneda(v: number | null): string {
  if (v == null) return "—";
  return `Q${v.toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

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

  function setMonto(planId: number, monto: number) {
    setLineas((prev) => prev.map((l) => (l.planId === planId ? { ...l, montoAsignado: monto } : l)));
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
      { planId: v.planId, codigo: v.codigo, fechaPlan: v.fechaPlan, placa: v.placa, tarifaComercial: v.tarifaComercial, montoAsignado: v.tarifaComercial ?? 0 },
    ]);
    setPendientesCliente((prev) => prev.filter((p) => p.planId !== v.planId));
  }

  const idsEnLineas = useMemo(() => new Set(lineas.map((l) => l.planId)), [lineas]);
  const disponiblesParaAgregar = pendientesCliente.filter((v) => !idsEnLineas.has(v.planId));

  async function guardar() {
    if (!lineas.length) { setError("Selecciona al menos un viaje."); return; }
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
          planes: lineas.map((l) => ({ planId: l.planId, montoAsignado: l.montoAsignado })),
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
                  <td className="whitespace-nowrap px-2 py-1.5 text-xs">{moneda(l.tarifaComercial)}</td>
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
                    <button type="button" className="text-xs text-rose-500 hover:underline" onClick={() => quitarLinea(l.planId)}>Quitar</button>
                  </td>
                </tr>
              );
            })}
            {!lineas.length ? (
              <tr><td colSpan={6} className="px-3 py-4 text-center text-xs text-[var(--muted)]">Sin viajes en esta factura.</td></tr>
            ) : null}
          </tbody>
          <tfoot>
            <tr className="border-t border-[var(--border)] font-medium">
              <td colSpan={4} className="px-2 py-1.5 text-right text-xs text-[var(--muted)]">Total</td>
              <td colSpan={2} className="px-2 py-1.5 text-sm text-[var(--text)]">{moneda(total)}</td>
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
                  <span>{v.codigo} · {v.fechaPlan} · {moneda(v.tarifaComercial)}</span>
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

      {error ? <p className="text-sm text-rose-500">{error}</p> : null}

      <div className="flex flex-wrap gap-2 pt-1">
        <button type="button" disabled={guardando} className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm text-white disabled:opacity-60" onClick={() => void guardar()}>
          {guardando ? "Guardando…" : "Guardar borrador"}
        </button>
        <button type="button" disabled={guardando} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--text)]" onClick={onCancelar}>
          Cancelar
        </button>
      </div>
    </div>
  );
}
