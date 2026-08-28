"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FacturaBorradorForm, type LineaBorrador } from "@/components/facturacion/factura-borrador-form";
import { calcularTotalPaginas, evaluarSeleccion } from "@/lib/facturacion/ui-logica";

/**
 * FACT-1-UI (Fase D/E) — Operaciones → Facturación clientes → Viajes
 * pendientes. Consume GET /facturacion/viajes-pendientes (paginado,
 * totalReal independiente — ver src/lib/facturacion/facturas.ts). Solo
 * viajes TMS Cerrados SIN factura viva (mismo criterio derivado que usa
 * el backend, nunca recalculado aquí).
 */

type ViajePendiente = {
  planId: number;
  codigo: string;
  fechaPlan: string;
  clienteId: number | null;
  cliente: string | null;
  placa: string | null;
  tarifaComercial: number | null;
  cerradoEn: string | null;
};

type ClienteCat = { clienteId: number; nombre: string };

type Props = {
  slug: string;
  puedeCrear: boolean;
  onFacturaCreada: (facturaId: number) => void;
};

function moneda(v: number | null): string {
  if (v == null) return "—";
  return `Q${v.toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const inputCls = "rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1.5 text-sm text-[var(--text)]";
const PAGE_SIZE = 50;

export function ViajesPendientesPanel({ slug, puedeCrear, onFacturaCreada }: Props) {
  const [clientesCat, setClientesCat] = useState<ClienteCat[]>([]);
  useEffect(() => {
    fetch(`/api/empresas/${slug}/facturacion/clientes`)
      .then((r) => r.json())
      .then((data) => setClientesCat(((data.clientes ?? []) as ClienteCat[])))
      .catch(() => undefined);
  }, [slug]);

  const [fCliente, setFCliente] = useState("");
  const [fDesde, setFDesde] = useState("");
  const [fHasta, setFHasta] = useState("");

  const [viajes, setViajes] = useState<ViajePendiente[]>([]);
  const [page, setPage] = useState(1);
  const [totalReal, setTotalReal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const filtrosQueryString = useCallback(() => {
    const p = new URLSearchParams();
    if (fCliente) p.set("clienteId", fCliente);
    if (fDesde) p.set("fechaDesde", fDesde);
    if (fHasta) p.set("fechaHasta", fHasta);
    return p;
  }, [fCliente, fDesde, fHasta]);

  const cargar = useCallback(async (paginaSolicitada = 1) => {
    setLoading(true);
    setError("");
    try {
      const p = filtrosQueryString();
      p.set("page", String(paginaSolicitada));
      p.set("pageSize", String(PAGE_SIZE));
      const res = await fetch(`/api/empresas/${slug}/facturacion/viajes-pendientes?${p.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error ?? "No se pudo cargar los viajes pendientes."); return; }
      setViajes((data.viajes ?? []) as ViajePendiente[]);
      setTotalReal(Number(data.totalReal ?? 0));
      setPage(paginaSolicitada);
    } catch {
      setError("Error de conexión.");
    } finally {
      setLoading(false);
    }
  }, [slug, filtrosQueryString]);

  const [buscarTick, setBuscarTick] = useState(0);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void cargar(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buscarTick]);

  function buscar() { setBuscarTick((t) => t + 1); }
  function limpiarFiltros() {
    setFCliente(""); setFDesde(""); setFHasta("");
    setBuscarTick((t) => t + 1);
  }

  // Selección — SOLO del mismo cliente. Se guarda el detalle completo (no
  // solo el id) porque la fila puede salir de la página actual al paginar
  // y aun así debe seguir disponible para armar la factura.
  const [seleccion, setSeleccion] = useState<Map<number, ViajePendiente>>(new Map());
  const [avisoSeleccion, setAvisoSeleccion] = useState("");
  const clienteSeleccionado = useMemo(() => {
    const first = seleccion.values().next().value as ViajePendiente | undefined;
    return first ? { id: first.clienteId, nombre: first.cliente } : null;
  }, [seleccion]);

  function toggleSeleccion(v: ViajePendiente) {
    setAvisoSeleccion("");
    setSeleccion((prev) => {
      const resultado = evaluarSeleccion(v, prev);
      if (resultado.accion === "rechazar") {
        setAvisoSeleccion(resultado.mensaje);
        return prev;
      }
      const next = new Map(prev);
      if (resultado.accion === "quitar") next.delete(v.planId);
      else next.set(v.planId, v);
      return next;
    });
  }

  const [creando, setCreando] = useState(false);

  function crearFacturaConSeleccionados() {
    if (!seleccion.size) return;
    setCreando(true);
  }

  const totalPaginas = calcularTotalPaginas(totalReal, PAGE_SIZE);

  if (creando && clienteSeleccionado) {
    const lineas: LineaBorrador[] = Array.from(seleccion.values())
      .sort((a, b) => a.fechaPlan.localeCompare(b.fechaPlan))
      .map((v) => ({ planId: v.planId, codigo: v.codigo, fechaPlan: v.fechaPlan, placa: v.placa, tarifaComercial: v.tarifaComercial, montoAsignado: v.tarifaComercial ?? 0 }));
    return (
      <FacturaBorradorForm
        slug={slug}
        clienteId={clienteSeleccionado.id!}
        clienteNombre={clienteSeleccionado.nombre ?? `Cliente #${clienteSeleccionado.id}`}
        lineasIniciales={lineas}
        onGuardado={(facturaId) => {
          setCreando(false);
          setSeleccion(new Map());
          onFacturaCreada(facturaId);
          void cargar(1);
        }}
        onCancelar={() => setCreando(false)}
      />
    );
  }

  return (
    <div className="space-y-3">
      <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3">
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
            Cliente
            <select className={inputCls} value={fCliente} onChange={(e) => setFCliente(e.target.value)}>
              <option value="">Todos</option>
              {clientesCat.map((c) => <option key={c.clienteId} value={c.clienteId}>{c.nombre}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
            Fecha desde
            <input className={inputCls} type="date" value={fDesde} onChange={(e) => setFDesde(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
            Fecha hasta
            <input className={inputCls} type="date" value={fHasta} onChange={(e) => setFHasta(e.target.value)} />
          </label>
          <button type="button" className="rounded bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white" onClick={buscar}>Buscar</button>
          <button type="button" className="rounded border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text)]" onClick={limpiarFiltros}>Limpiar filtros</button>
        </div>
      </section>

      {error ? <p className="text-sm text-rose-500">{error}</p> : null}

      {puedeCrear ? (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={!seleccion.size}
            className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm text-white disabled:opacity-40"
            onClick={crearFacturaConSeleccionados}
          >
            Crear factura con seleccionados ({seleccion.size})
          </button>
          {clienteSeleccionado ? (
            <span className="text-xs text-[var(--muted)]">Cliente: {clienteSeleccionado.nombre ?? `#${clienteSeleccionado.id}`}</span>
          ) : null}
        </div>
      ) : null}
      {avisoSeleccion ? <p className="text-sm text-amber-600">{avisoSeleccion}</p> : null}

      <div className="table-scroll rounded-xl border border-[var(--border)]">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-[var(--thead)] text-xs uppercase text-[var(--muted)]">
            <tr>
              {puedeCrear ? <th className="px-2 py-2" /> : null}
              <th className="px-2 py-2">Fecha</th>
              <th className="px-2 py-2">Código</th>
              <th className="px-2 py-2">Cliente</th>
              <th className="px-2 py-2">Unidad</th>
              <th className="px-2 py-2">Tarifa comercial</th>
              <th className="px-2 py-2">Fecha cierre</th>
            </tr>
          </thead>
          <tbody>
            {viajes.map((v) => {
              const marcado = seleccion.has(v.planId);
              const bloqueado = !marcado && clienteSeleccionado != null && v.clienteId !== clienteSeleccionado.id;
              return (
                <tr key={v.planId} className={`border-t border-[var(--border)] ${bloqueado ? "opacity-45" : ""}`}>
                  {puedeCrear ? (
                    <td className="px-2 py-1.5">
                      <input type="checkbox" checked={marcado} onChange={() => toggleSeleccion(v)} />
                    </td>
                  ) : null}
                  <td className="whitespace-nowrap px-2 py-1.5 text-xs">{v.fechaPlan}</td>
                  <td className="px-2 py-1.5 font-mono text-xs">{v.codigo}</td>
                  <td className="px-2 py-1.5 text-xs">{v.cliente ?? "—"}</td>
                  <td className="px-2 py-1.5 text-xs">{v.placa ?? "—"}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-xs">{moneda(v.tarifaComercial)}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-xs">{v.cerradoEn ? v.cerradoEn.replace("T", " ") : "—"}</td>
                </tr>
              );
            })}
            {!viajes.length && !loading ? (
              <tr><td colSpan={puedeCrear ? 7 : 6} className="px-3 py-4 text-center text-sm text-[var(--muted)]">Sin viajes pendientes de facturación con estos filtros.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--muted)]">
        <span>{totalReal ? `${totalReal} viaje(s) pendiente(s)` : loading ? "Cargando…" : "Sin viajes con estos filtros."}</span>
        <div className="flex gap-2">
          <button type="button" className="rounded border border-[var(--border)] px-2.5 py-1 text-[var(--text)] disabled:opacity-40" disabled={loading || page <= 1} onClick={() => void cargar(page - 1)}>← Anterior</button>
          <span className="px-1 py-1">Página {page} de {totalPaginas}</span>
          <button type="button" className="rounded border border-[var(--border)] px-2.5 py-1 text-[var(--text)] disabled:opacity-40" disabled={loading || page >= totalPaginas} onClick={() => void cargar(page + 1)}>Siguiente →</button>
        </div>
      </div>
    </div>
  );
}
