"use client";

import { useState } from "react";
import type { DryRunReconstruccion } from "@/lib/rrhh/vacaciones-reconstruccion-plan";

/**
 * Simular reconstrucción (dry-run) — SOLO LECTURA. Muestra lo que haría el aplicador controlado (vacaciones e incidencias nuevas, evidencias a
 * relinkear, saldo final por empleado, decisiones pendientes y si puede aplicarse). NO existe aquí ninguna acción de aplicar ni de limpiar.
 */
export function SimularReconstruccionVacaciones({ slug }: { slug: string }) {
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");
  const [r, setR] = useState<DryRunReconstruccion | null>(null);
  const [decisionesTexto, setDecisionesTexto] = useState("");

  async function simular() {
    setCargando(true); setError(""); setR(null);
    try {
      let decisiones: unknown;
      if (decisionesTexto.trim()) {
        try { decisiones = JSON.parse(decisionesTexto); } catch { setError("Las decisiones deben ser un JSON válido (una lista)."); return; }
      }
      const res = await fetch(`/api/empresas/${slug}/rrhh/vacaciones/reconstruccion/dry-run`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decisiones }) });
      const data = await res.json();
      if (!res.ok) setError(data.error ?? "No se pudo simular la reconstrucción.");
      else setR(data as DryRunReconstruccion);
    } catch {
      setError("No se pudo simular la reconstrucción.");
    } finally {
      setCargando(false);
    }
  }

  return (
    <div className="space-y-3 border-t border-[var(--border)] pt-3">
      <h3 className="text-xs font-semibold uppercase text-[var(--muted)]">Simular reconstrucción (dry-run)</h3>
      <p className="text-xs text-[var(--muted)]">
        Calcula, <strong>sin escribir nada</strong>, la reconstrucción de las vacaciones desde el historial actual preservando las evidencias:
        vacaciones e incidencias nuevas, relink de evidencias, saldo final por empleado y decisiones pendientes. La aplicación real no existe en esta pantalla.
      </p>
      <textarea
        value={decisionesTexto} onChange={(e) => setDecisionesTexto(e.target.value)} rows={3}
        placeholder='Decisiones aprobadas (opcional), JSON: [{"clave":"…","tipo":"ACEPTAR_PROPUESTA","huella":"…","resueltoPor":"…","resueltoEn":"2026-10-07T10:00:00-06:00","motivo":"…"}]'
        className="w-full rounded border border-[var(--border)] bg-transparent p-2 font-mono text-xs"
      />
      <button type="button" disabled={cargando} onClick={() => void simular()} className="rounded border border-[var(--border)] px-3 py-1.5 disabled:opacity-50">
        {cargando ? "Simulando…" : "Simular reconstrucción"}
      </button>
      {error ? <p className="text-red-300">{error}</p> : null}

      {r ? (
        <div className="space-y-3">
          <p className={`rounded border p-2 text-xs ${r.puedeAplicarse ? "border-emerald-400/40 text-emerald-200" : "border-red-400/40 text-red-200"}`}>
            {r.puedeAplicarse ? "La reconstrucción cumple todas las condiciones." : "La reconstrucción NO puede aplicarse todavía."} No se escribió nada. Huella de la fuente: <code>{r.huellaFuente.slice(0, 16)}…</code>
          </p>
          <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            {([
              ["Vacaciones a reconstruir", r.resumen.vacacionesAReconstruir], ["Incidencias nuevas esperadas", r.resumen.incidenciasNuevasEsperadas],
              ["Líneas de FIFO nuevas", r.resumen.detalleFifoEsperado], ["Empleados a reconstruir", r.resumen.empleadosAReconstruir],
              ["Saldos a eliminar", r.resumen.saldosAEliminar], ["Saldos a generar", r.resumen.saldosAGenerar],
              ["Evidencias a relinkear", r.resumen.evidenciasARelinkear], ["Evidencias relinkeables", r.resumen.evidenciasRelinkeables],
              ["Errores de relink", r.resumen.erroresRelink], ["Decisiones pendientes", r.resumen.decisionesPendientes],
            ] as [string, number][]).map(([k, v]) => (
              <div key={k} className="rounded border border-[var(--border)] p-2"><dt className="text-[var(--muted)]">{k}</dt><dd className="text-base font-semibold">{v}</dd></div>
            ))}
          </dl>
          {r.bloqueos.length ? (
            <ul className="space-y-1 text-xs text-red-300">{r.bloqueos.map((b, i) => <li key={`${b.codigo}-${i}`}><strong>{b.codigo}</strong>: {b.mensaje}</li>)}</ul>
          ) : null}
          {r.decisiones.pendientes.length ? (
            <div>
              <h4 className="mb-1 text-xs font-semibold uppercase text-[var(--muted)]">Decisiones pendientes</h4>
              <ul className="space-y-2 text-xs">
                {r.decisiones.pendientes.map((p) => (
                  <li key={p.clave} className="rounded border border-amber-400/40 p-2 text-amber-200">
                    <strong>{p.empleado}</strong> · {p.codigo} · {p.inicio} → {p.fin} ({p.dias} d.)<br />{p.mensaje}
                    <pre className="mt-1 whitespace-pre-wrap break-all text-[10px] text-[var(--muted)]">{JSON.stringify(p.plantilla)}</pre>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {r.omitidos.length ? <p className="text-xs text-[var(--muted)]">Omitidos (no se tocan): {r.omitidos.map((o) => `${o.nombre} — ${o.motivo}`).join(" · ")}</p> : null}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-[var(--muted)]"><tr><th className="py-1 pr-3">Empleado</th><th className="pr-3 text-right">Vacaciones</th><th className="pr-3 text-right">Períodos</th><th className="pr-3 text-right">Otorgado</th><th className="pr-3 text-right">Consumido</th><th className="pr-3 text-right">Saldo final</th></tr></thead>
              <tbody>
                {r.saldoFinalPorEmpleado.map((e) => (
                  <tr key={e.empleadoId} className="border-t border-[var(--border)]">
                    <td className="py-1 pr-3">{e.nombre} <span className="text-[var(--muted)]">({e.codigo})</span></td>
                    <td className="pr-3 text-right">{e.vacaciones}</td><td className="pr-3 text-right">{e.periodos}</td>
                    <td className="pr-3 text-right">{e.resumenDias.otorgado.toFixed(2)}</td><td className="pr-3 text-right">{e.resumenDias.consumido.toFixed(2)}</td>
                    <td className="pr-3 text-right">{e.saldoFinal.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}
