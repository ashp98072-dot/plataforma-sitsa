"use client";

import { useEffect, useState } from "react";
import type { EventoLiquidacionViaje, LiquidacionViaje } from "@/lib/tms/liquidacion-viaje";
import type { SnapshotOperativoViaje } from "@/lib/tms/liquidacion-viaje-shared";

/**
 * LIQUIDACIÓN DE VIAJES, FASE 3 — modales de «Liquidar viaje» / «Liquidar nuevamente» y «Reabrir liquidación», más el
 * historial de eventos para el detalle del viaje. Solo presentación: las reglas (transiciones, versión, tenant, snapshot) las
 * decide el servidor; nada aquí cierra el viaje, factura, crea cargos ni mueve fondos/gastos.
 */

type VistaLiquidacion = {
  liquidacion: LiquidacionViaje | null;
  eventos: EventoLiquidacionViaje[];
  vistaPrevia: SnapshotOperativoViaje | null;
};

const inputCls = "rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1.5 text-sm text-[var(--text)]";
const dinero = (v: string | null, moneda: string | null) =>
  v == null ? "Sin tarifa" : `${moneda && moneda !== "GTQ" ? `${moneda} ` : "Q"}${Number(v).toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fh = (v: string | null | undefined) => (v ? v.replace("T", " ") : "—");

function useVistaLiquidacion(slug: string, planId: number) {
  const [vista, setVista] = useState<VistaLiquidacion | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let activo = true;
    (async () => {
      try {
        const res = await fetch(`/api/empresas/${slug}/tms/planes/${planId}/liquidacion`);
        const data = await res.json().catch(() => ({}));
        if (!activo) return;
        if (!res.ok) setError(data.error ?? "No se pudo leer la liquidación.");
        else setVista(data as VistaLiquidacion);
      } catch {
        if (activo) setError("Error de conexión.");
      }
    })();
    return () => {
      activo = false;
    };
  }, [slug, planId]);
  return { vista, error };
}

function Fondo({ children, etiqueta }: { children: React.ReactNode; etiqueta: string }) {
  return (
    <div role="dialog" aria-modal="true" aria-label={etiqueta} className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="max-h-[90vh] w-full max-w-lg space-y-3 overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 text-sm text-[var(--text)]">
        {children}
      </div>
    </div>
  );
}

function Resumen({ s }: { s: SnapshotOperativoViaje }) {
  const fila = (k: string, v: React.ReactNode) => (
    <li className="flex gap-2"><span className="w-32 shrink-0 text-[var(--muted)]">{k}</span><span className="min-w-0">{v}</span></li>
  );
  return (
    <ul className="space-y-0.5 text-xs">
      {fila("Viaje", <span className="font-mono">{s.plan.codigo}</span>)}
      {fila("Fecha", s.plan.fechaPlan ?? "—")}
      {fila("Cliente", s.cliente.nombre ?? "—")}
      {fila("Ruta", [s.ruta.codigo, s.ruta.origen && s.ruta.destino ? `${s.ruta.origen} → ${s.ruta.destino}` : s.ruta.destino].filter(Boolean).join(" · ") || "—")}
      {fila("Unidad / placa", s.unidad.placa ?? "—")}
      {s.tc.placa ? fila("TC", `${s.tc.placa} (${s.tc.origen === "EXTERNO" ? "externo" : "interno"})`) : null}
      {fila("Piloto", [s.piloto.nombre, ...s.pilotosExtra.map((p) => `${p.nombre} (extra)`)].filter(Boolean).join(", ") || "—")}
      {fila("Auxiliares", s.auxiliares.map((a) => a.nombre).join(", ") || "—")}
      {fila("Cuadrilla", s.cuadrilla.length ? s.cuadrilla.map((c) => `${c.nombre} (${c.tipo === "INTERNO" ? "interno" : "externo"})`).join(", ") : "—")}
      {s.tercerizado
        ? fila("Tercerizado", [s.tercerizado.transportistaExterno, s.tercerizado.unidadExternaPlaca, s.tercerizado.pilotoExterno].filter(Boolean).join(" · ") || "Sí")
        : null}
      {fila("Tarifa base", <strong>{dinero(s.tarifa.comercial, s.tarifa.moneda)}</strong>)}
      {fila(
        "Registro del piloto",
        s.viajeFisico
          ? `Salida ${fh(s.viajeFisico.horaSalida)} · Llegada ${fh(s.viajeFisico.horaLlegada)} · Km ${s.viajeFisico.kmSalida ?? "—"} → ${s.viajeFisico.kmLlegada ?? "—"}${s.viajeFisico.kmRecorridos != null ? ` (${s.viajeFisico.kmRecorridos} km)` : ""}`
          : "Sin salida/llegada registrada por el piloto",
      )}
    </ul>
  );
}

export function ModalLiquidarViaje({
  slug, planId, codigo, onClose, onDone,
}: { slug: string; planId: number; codigo: string; onClose: () => void; onDone: () => void }) {
  const { vista, error: errorLectura } = useVistaLiquidacion(slug, planId);
  const [observacion, setObservacion] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");

  const l = vista?.liquidacion ?? null;
  const reliquidar = l?.estado === "EN_AJUSTE";
  const titulo = reliquidar ? "Liquidar nuevamente" : "Liquidar viaje";
  const puede = !!vista && !!l && vista.vistaPrevia != null && (l.estado === "REPORTE_RECIBIDO" || l.estado === "EN_AJUSTE");

  async function liquidar() {
    if (!l || enviando) return;
    setEnviando(true);
    setError("");
    try {
      const res = await fetch(`/api/empresas/${slug}/tms/planes/${planId}/liquidar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedVersion: l.version, observacion: observacion.trim() || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "No se pudo liquidar el viaje.");
        return;
      }
      onDone();
    } catch {
      setError("Error de conexión.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Fondo etiqueta={titulo}>
      <h2 className="text-base font-semibold">{titulo}</h2>
      <p className="text-xs text-[var(--muted)]">Viaje <span className="font-mono">{codigo}</span> · versión {l?.version ?? "—"}</p>
      {!vista && !errorLectura ? <p className="text-xs text-[var(--muted)]">Cargando resumen…</p> : null}
      {errorLectura ? <p className="text-xs text-rose-500">{errorLectura}</p> : null}
      {vista && !puede && !errorLectura ? (
        <p className="text-xs text-amber-400">Este viaje no está pendiente de liquidar (estado actual: {l?.estado ?? "sin reporte recibido"}). Recarga la lista.</p>
      ) : null}
      {puede && vista?.vistaPrevia ? (
        <>
          <p className="text-xs font-medium">Esto es lo que quedará congelado en el historial de la liquidación:</p>
          <div className="rounded border border-[var(--border)] bg-[var(--panel)] p-2">
            <Resumen s={vista.vistaPrevia} />
            <p className="mt-1 text-xs"><span className="text-[var(--muted)]">Reporte recibido: </span>{l?.reporteRecibidoEn ?? "—"}</p>
          </div>
          <label className="block text-xs text-[var(--muted)]">
            Observación (opcional)
            <textarea className={`${inputCls} mt-1 block w-full`} rows={2} maxLength={500} value={observacion} disabled={enviando} onChange={(e) => setObservacion(e.target.value)} />
          </label>
          <div className="rounded border border-[var(--border)] px-2 py-1.5 text-xs">
            Liquidar <strong>no</strong> cierra el viaje, <strong>no</strong> factura, <strong>no</strong> crea cargos y <strong>no</strong> mueve
            fondos ni gastos.
          </div>
        </>
      ) : null}
      {error ? <p className="text-xs text-rose-500">{error}</p> : null}
      <div className="flex justify-end gap-2">
        <button type="button" className="rounded border border-[var(--border)] px-3 py-1.5 text-xs" disabled={enviando} onClick={onClose}>
          Cancelar
        </button>
        <button type="button" className="rounded bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50" disabled={!puede || enviando} onClick={() => void liquidar()}>
          {enviando ? "Liquidando…" : titulo}
        </button>
      </div>
    </Fondo>
  );
}

export function ModalReabrirLiquidacion({
  slug, planId, codigo, onClose, onDone,
}: { slug: string; planId: number; codigo: string; onClose: () => void; onDone: () => void }) {
  const { vista, error: errorLectura } = useVistaLiquidacion(slug, planId);
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");
  const l = vista?.liquidacion ?? null;
  const puede = !!l && l.estado === "LIQUIDADO";
  const motivoValido = motivo.trim().length >= 5;

  async function reabrir() {
    if (!l || !motivoValido || enviando) return;
    setEnviando(true);
    setError("");
    try {
      const res = await fetch(`/api/empresas/${slug}/tms/planes/${planId}/reabrir-liquidacion`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedVersion: l.version, motivo: motivo.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "No se pudo reabrir la liquidación.");
        return;
      }
      onDone();
    } catch {
      setError("Error de conexión.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Fondo etiqueta="Reabrir liquidación">
      <h2 className="text-base font-semibold">Reabrir liquidación</h2>
      <p className="text-xs text-[var(--muted)]">Viaje <span className="font-mono">{codigo}</span> · versión {l?.version ?? "—"}</p>
      {!vista && !errorLectura ? <p className="text-xs text-[var(--muted)]">Cargando…</p> : null}
      {errorLectura ? <p className="text-xs text-rose-500">{errorLectura}</p> : null}
      {vista && !puede && !errorLectura ? (
        <p className="text-xs text-amber-400">Solo una liquidación en estado Liquidado puede reabrirse (estado actual: {l?.estado ?? "sin liquidación"}).</p>
      ) : null}
      <ul className="list-disc space-y-0.5 pl-5 text-xs">
        <li>El viaje vuelve al estado <strong>En ajuste</strong>.</li>
        <li>La liquidación anterior <strong>permanece en el historial</strong>; no se borra ni se edita.</li>
        <li>Después deberá <strong>liquidarse nuevamente</strong>.</li>
      </ul>
      <label className="block text-xs text-[var(--muted)]">
        Motivo de reapertura (obligatorio, mínimo 5 caracteres)
        <textarea className={`${inputCls} mt-1 block w-full`} rows={3} maxLength={500} value={motivo} disabled={enviando || !puede} onChange={(e) => setMotivo(e.target.value)} />
      </label>
      {error ? <p className="text-xs text-rose-500">{error}</p> : null}
      <div className="flex justify-end gap-2">
        <button type="button" className="rounded border border-[var(--border)] px-3 py-1.5 text-xs" disabled={enviando} onClick={onClose}>
          Cancelar
        </button>
        <button type="button" className="rounded bg-orange-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50" disabled={!puede || !motivoValido || enviando} onClick={() => void reabrir()}>
          {enviando ? "Reabriendo…" : "Reabrir liquidación"}
        </button>
      </div>
    </Fondo>
  );
}

const ETIQUETA_EVENTO: Record<string, string> = {
  REPORTE_RECIBIDO: "Reporte recibido",
  LIQUIDADO: "Liquidado",
  REABIERTO: "Reabierto",
  RELIQUIDADO: "Liquidado nuevamente",
};

/** Historial append-only de la liquidación (versión, evento, estado antes/después, actor, fecha, detalle). */
export function HistorialLiquidacion({ eventos }: { eventos: EventoLiquidacionViaje[] }) {
  if (!eventos.length) return null;
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Historial de liquidación</p>
      <div className="mt-1 overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-[var(--muted)]">
            <tr>
              <th className="px-1 py-0.5">Ver.</th><th className="px-1 py-0.5">Evento</th><th className="px-1 py-0.5">Antes → después</th>
              <th className="px-1 py-0.5">Usuario</th><th className="px-1 py-0.5">Fecha</th><th className="px-1 py-0.5">Detalle / motivo</th>
            </tr>
          </thead>
          <tbody>
            {eventos.map((e) => (
              <tr key={e.id} className="border-t border-[var(--border)] align-top">
                <td className="px-1 py-0.5">{e.version}</td>
                <td className="px-1 py-0.5">{ETIQUETA_EVENTO[e.tipo] ?? e.tipo}</td>
                <td className="px-1 py-0.5">{e.estadoAntes ?? "—"} → {e.estadoDespues}</td>
                <td className="px-1 py-0.5">#{e.actorId}</td>
                <td className="whitespace-nowrap px-1 py-0.5">{e.creadoEn}</td>
                <td className="px-1 py-0.5">{e.detalle ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
