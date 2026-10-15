"use client";

import { useEffect, useState } from "react";
import {
  ETIQUETA_SUBTOTAL_COMERCIAL,
  NOTA_SUBTOTAL_COMERCIAL,
  type ResumenLiquidacionViaje,
} from "@/lib/tms/resumen-liquidacion-shared";

/**
 * TMS, FASE 5 — «Resumen de liquidación» del detalle del viaje. SOLO LECTURA: no modifica la liquidación, los cargos, la
 * facturación ni la contabilidad. Tres bloques que nunca se mezclan: comercial (tarifa + cargos), costos internos (solo con
 * permiso de Gastos; el backend no los envía a quien no lo tiene) y lo no consolidado.
 */

const ETIQUETA_ESTADO: Record<string, string> = {
  REPORTE_RECIBIDO: "Reporte recibido",
  LIQUIDADO: "Liquidado",
  EN_AJUSTE: "En ajuste",
};

function dinero(valor: string | null, moneda: string): string {
  if (valor == null) return "—";
  const n = Number(valor);
  if (!Number.isFinite(n)) return "—";
  return `${moneda} ${n.toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function ResumenLiquidacionViajeCard({ slug, planId, version }: { slug: string; planId: number; version: string }) {
  const [resumen, setResumen] = useState<ResumenLiquidacionViaje | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelado = false;
    fetch(`/api/empresas/${slug}/tms/planes/${planId}/resumen-liquidacion`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (cancelado) return;
        if (!res.ok) {
          setError((data as { error?: string }).error ?? "No se pudo cargar el resumen de liquidación.");
        } else {
          setError("");
          setResumen(data as ResumenLiquidacionViaje);
        }
      })
      .catch(() => {
        if (!cancelado) setError("Error de conexión.");
      });
    return () => {
      cancelado = true;
    };
    // `version` cambia cuando se liquida/reabre/cierra: se vuelve a leer el resumen.
  }, [slug, planId, version]);

  if (error) return <p className="text-xs text-[var(--danger,#b91c1c)]" role="alert">{error}</p>;
  if (!resumen) return <p className="text-xs text-[var(--muted)]">Cargando resumen de liquidación…</p>;

  const { comercial, liquidacion, snapshotComercial, costos } = resumen;
  const mon = comercial.moneda;
  const estadoTexto = liquidacion.estado ? ETIQUETA_ESTADO[liquidacion.estado] ?? liquidacion.estado : "Sin liquidación";

  return (
    <section
      aria-label="Resumen de liquidación"
      data-testid="resumen-liquidacion"
      data-estado-liquidacion={liquidacion.estado ?? "NINGUNA"}
      className={`rounded-lg border p-3 ${liquidacion.finalizada ? "border-[var(--success,#15803d)]" : "border-[var(--border)]"}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Resumen de liquidación</h3>
        <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-[10px] font-semibold text-[var(--text)]">
          {estadoTexto}
          {liquidacion.finalizada ? " · finalizado" : ""}
        </span>
      </div>

      {liquidacion.sujetoACambios ? (
        <p className="mt-2 rounded bg-[var(--warning-bg,#fef3c7)] px-2 py-1 text-[11px] text-[var(--warning-text,#92400e)]" role="status">
          Sujeto a cambios: la liquidación está en ajuste y los importes pueden variar hasta liquidar nuevamente.
        </p>
      ) : null}

      <div className="mt-3 grid gap-4 md:grid-cols-2">
        <div data-bloque="comercial">
          <p className="text-[11px] font-semibold text-[var(--text)]">Comercial (al cliente)</p>
          <dl className="mt-1 space-y-0.5 text-xs text-[var(--text)]">
            <div className="flex justify-between gap-3">
              <dt>Tarifa base</dt>
              <dd className="tabular-nums">{comercial.tarifaBase == null ? "Sin tarifa asignada" : dinero(comercial.tarifaBase, mon)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>Cargos adicionales ({comercial.cargosAdicionales.cantidad})</dt>
              <dd className="tabular-nums">{dinero(comercial.cargosAdicionales.total, mon)}</dd>
            </div>
            {comercial.cargosAdicionales.items.map((c) => (
              <div key={c.id} className="flex justify-between gap-3 pl-3 text-[11px] text-[var(--muted)]">
                <dt className="truncate" title={c.observacion ?? c.concepto}>{c.concepto}</dt>
                <dd className="tabular-nums">{dinero(c.monto, mon)}</dd>
              </div>
            ))}
            <div className="flex justify-between gap-3 border-t border-[var(--border)] pt-1 font-semibold">
              <dt>{ETIQUETA_SUBTOTAL_COMERCIAL}</dt>
              <dd className="tabular-nums" data-testid="subtotal-comercial">
                {comercial.subtotalComercial == null ? "—" : dinero(comercial.subtotalComercial, mon)}
              </dd>
            </div>
          </dl>
          <p className="mt-1 text-[10px] text-[var(--muted)]">{NOTA_SUBTOTAL_COMERCIAL}</p>
          {snapshotComercial ? (
            <p className="mt-2 text-[11px] text-[var(--muted)]">
              Congelado en la liquidación v{snapshotComercial.version} ({snapshotComercial.liquidadoEn}):{" "}
              {snapshotComercial.incluyeCargos
                ? `subtotal ${dinero(snapshotComercial.subtotalComercial, snapshotComercial.moneda ?? mon)}`
                : `tarifa ${dinero(snapshotComercial.tarifaBase, snapshotComercial.moneda ?? mon)} (liquidado antes de los cargos adicionales; sin cargos congelados)`}
              {snapshotComercial.difiereDelActual ? " · difiere del importe actual" : ""}
            </p>
          ) : null}
        </div>

        <div data-bloque="costos-internos">
          <p className="text-[11px] font-semibold text-[var(--text)]">Costos internos (informativo, no se suma al subtotal comercial)</p>
          {!resumen.costosAutorizado || !costos ? (
            <p className="mt-1 text-[11px] text-[var(--muted)]">Sin permiso para ver costos internos.</p>
          ) : (
            <dl className="mt-1 space-y-0.5 text-xs text-[var(--text)]">
              <div className="flex justify-between gap-3">
                <dt>Gastos autorizados</dt>
                <dd className="tabular-nums">{costos.costoRegistrado ? dinero(costos.costoRegistrado.total, costos.moneda) : "No consolidable"}</dd>
              </div>
              {costos.costoRegistrado?.porCategoria.map((c) => (
                <div key={c.categoria} className="flex justify-between gap-3 pl-3 text-[11px] text-[var(--muted)]">
                  <dt>{c.categoria} ({c.cantidad})</dt>
                  <dd className="tabular-nums">{dinero(c.total, costos.moneda)}</dd>
                </div>
              ))}
              <div className="flex justify-between gap-3 text-[11px] text-[var(--muted)]">
                <dt>No incluidos: pendientes / rechazados / históricos</dt>
                <dd className="tabular-nums">
                  {costos.noIncluidos.pendientes.cantidad} / {costos.noIncluidos.rechazados.cantidad} / {costos.noIncluidos.historicos.cantidad}
                </dd>
              </div>
              <div className="flex justify-between gap-3 text-[11px] text-[var(--muted)]">
                <dt>Anticipos solicitados ({costos.anticiposFondo.lineas} líneas)</dt>
                <dd className="tabular-nums">{dinero(costos.anticiposFondo.montoSolicitado, costos.moneda)}</dd>
              </div>
              {costos.costoTercerizado != null ? (
                <div className="flex justify-between gap-3 text-[11px] text-[var(--muted)]">
                  <dt>Costo del transportista externo</dt>
                  <dd className="tabular-nums">{dinero(costos.costoTercerizado, costos.moneda)}</dd>
                </div>
              ) : null}
            </dl>
          )}
          <p className="mt-2 text-[10px] text-[var(--muted)]" data-testid="margen-no-disponible">
            Margen informativo no disponible. {resumen.margen.motivo}
          </p>
        </div>
      </div>

      <details className="mt-3 text-[11px] text-[var(--muted)]">
        <summary className="cursor-pointer">Qué no está consolidado</summary>
        <ul className="mt-1 list-disc space-y-0.5 pl-4">
          {resumen.noConsolidado.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </details>
    </section>
  );
}
