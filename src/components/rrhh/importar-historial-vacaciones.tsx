"use client";

import { useState } from "react";
import type { ResultadoPreview, ProblemaPreview } from "@/lib/rrhh/vacaciones-historial-preview";

const COLOR: Record<ProblemaPreview["severidad"], string> = {
  BLOQUEANTE: "text-red-300",
  ERROR: "text-red-300",
  DECISION: "text-amber-300",
  ADVERTENCIA: "text-amber-200",
  INFO: "text-[var(--muted)]",
};
const ETIQUETA: Record<ProblemaPreview["severidad"], string> = {
  BLOQUEANTE: "Bloqueante", ERROR: "Error", DECISION: "Requiere decisión", ADVERTENCIA: "Advertencia", INFO: "Informativo",
};
const MAX_PROBLEMAS_VISIBLES = 200;

/**
 * Importar historial de vacaciones — SOLO VISTA PREVIA / SIMULACIÓN. Sube el archivo oficial de RRHH, muestra errores y advertencias,
 * el resumen por empleado y los saldos finales simulados. NO aplica nada: no escribe en la base de datos.
 */
export function ImportarHistorialVacaciones({ slug }: { slug: string }) {
  const [archivo, setArchivo] = useState<File | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<ResultadoPreview | null>(null);

  async function previsualizar() {
    if (!archivo) return;
    setCargando(true); setError(""); setPreview(null);
    try {
      const form = new FormData();
      form.set("archivo", archivo);
      const res = await fetch(`/api/empresas/${slug}/rrhh/vacaciones/importar-historial/preview`, { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) setError(data.error ?? "No se pudo generar la vista previa.");
      else setPreview(data as ResultadoPreview);
    } catch {
      setError("No se pudo generar la vista previa.");
    } finally {
      setCargando(false);
    }
  }

  const r = preview?.resumen;
  return (
    <details className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 text-sm">
      <summary className="cursor-pointer font-medium">Importar historial (solo vista previa)</summary>
      <div className="mt-3 space-y-3">
        <p className="text-xs text-[var(--muted)]">
          Sube el historial oficial de vacaciones de RRHH (.csv o .xlsx). Columnas obligatorias: un identificador del empleado (<code>codigo</code>, <code>dpi</code> o <code>nombre</code>),
          <code> fecha_inicio</code>, <code>fecha_fin</code> y <code>dias_habiles</code>; opcionales: <code>tipo</code> (Vacaciones / A cuenta de Vacaciones) y <code>observacion</code>.
          Esta herramienta <strong>solo simula</strong>: no guarda ni modifica ningún dato.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input type="file" accept=".csv,.xlsx,.txt" onChange={(e) => { setArchivo(e.target.files?.[0] ?? null); setPreview(null); setError(""); }} />
          <button type="button" disabled={!archivo || cargando} onClick={() => void previsualizar()} className="rounded bg-[var(--accent)] px-3 py-1.5 text-white disabled:opacity-50">
            {cargando ? "Analizando…" : "Vista previa"}
          </button>
        </div>
        {error ? <p className="text-red-300">{error}</p> : null}

        {preview && r ? (
          <div className="space-y-4">
            <p className={`rounded border p-2 text-xs ${preview.puedeAplicarse ? "border-emerald-400/40 text-emerald-200" : "border-red-400/40 text-red-200"}`}>
              {preview.puedeAplicarse
                ? "Sin errores ni bloqueantes. Revisa las advertencias y decisiones antes de pedir la reconstrucción real (paso posterior, no incluido aquí)."
                : "Hay errores o bloqueantes que corregir en el archivo o en las fichas antes de poder reconstruir."}
              {" "}No se escribió nada.
            </p>

            <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
              {([
                ["Filas leídas", r.filasLeidas], ["Válidas", r.filasValidas], ["Inválidas", r.filasInvalidas], ["Duplicadas", r.duplicadosEnArchivo],
                ["Empleados encontrados", r.empleadosEncontrados], ["No encontrados", r.empleadosNoEncontrados], ["Superpuestas", r.vacacionesSuperpuestas],
                ["Días calculados ≠ informados", r.diasCalculadosDistintos], ["Anteriores a fecha base", r.anterioresAFechaBase], ["Cruzan aniversario (decisión)", r.cruzanAniversario], ["Futuras", r.futuras],
                ["Empleados bloqueados", r.empleadosBloqueados], ["Requieren decisión", r.requierenDecision], ["Total de días en el archivo", r.totalDiasArchivo],
                ["Vacaciones actuales", preview.existentes.vacaciones], ["Actuales equivalentes al archivo", preview.existentes.equivalentesEnArchivo], ["Actuales que no están en el archivo", preview.existentes.noEnArchivo],
              ] as [string, number][]).map(([k, v]) => (
                <div key={k} className="rounded border border-[var(--border)] p-2"><dt className="text-[var(--muted)]">{k}</dt><dd className="text-base font-semibold">{v}</dd></div>
              ))}
            </dl>

            {preview.columnas.ignoradas.length ? <p className="text-xs text-[var(--muted)]">Columnas ignoradas: {preview.columnas.ignoradas.join(", ")}.</p> : null}

            {preview.problemas.length ? (
              <div>
                <h3 className="mb-1 text-xs font-semibold uppercase text-[var(--muted)]">Errores y advertencias ({preview.problemas.length})</h3>
                <ul className="max-h-72 space-y-1 overflow-y-auto text-xs">
                  {preview.problemas.slice(0, MAX_PROBLEMAS_VISIBLES).map((p, i) => (
                    <li key={`${p.codigo}-${i}`} className={COLOR[p.severidad]}>
                      <strong>{ETIQUETA[p.severidad]}</strong>{p.fila ? ` · fila ${p.fila}` : ""}{p.empleado ? ` · ${p.empleado}` : ""}: {p.mensaje}
                    </li>
                  ))}
                </ul>
                {preview.problemas.length > MAX_PROBLEMAS_VISIBLES ? <p className="text-xs text-[var(--muted)]">Se muestran los primeros {MAX_PROBLEMAS_VISIBLES}.</p> : null}
              </div>
            ) : null}

            <div className="overflow-x-auto">
              <h3 className="mb-1 text-xs font-semibold uppercase text-[var(--muted)]">Resumen por empleado y saldo final simulado</h3>
              <table className="w-full text-left text-xs">
                <thead className="text-[var(--muted)]">
                  <tr><th className="py-1 pr-3">Empleado</th><th className="pr-3">Fecha base</th><th className="pr-3 text-right">Vacaciones</th><th className="pr-3 text-right">Días</th><th className="pr-3 text-right">Períodos</th><th className="pr-3 text-right">Saldo final</th><th className="pr-3 text-right">Faltante</th><th>Estado</th></tr>
                </thead>
                <tbody>
                  {preview.empleados.map((e) => (
                    <tr key={e.empleadoId} className="border-t border-[var(--border)]">
                      <td className="py-1 pr-3">{e.nombre} <span className="text-[var(--muted)]">({e.codigo})</span></td>
                      <td className="pr-3">{e.fechaAlta ?? "—"}</td>
                      <td className="pr-3 text-right">{e.vacaciones}</td>
                      <td className="pr-3 text-right">{e.diasTotales.toFixed(2)}</td>
                      <td className="pr-3 text-right">{e.periodos}</td>
                      <td className="pr-3 text-right">{e.bloqueado ? "—" : e.saldoFinal.toFixed(2)}</td>
                      <td className="pr-3 text-right">{e.deficit > 0 ? e.deficit.toFixed(2) : "—"}</td>
                      <td className={e.bloqueado || e.advertencias.some((a) => a.severidad === "ERROR") ? "text-red-300" : e.advertencias.some((a) => a.severidad === "DECISION") ? "text-amber-300" : "text-emerald-300"}>
                        {e.bloqueado === "VACACIONES_SUPERPUESTAS" ? "Bloqueante: filas superpuestas (no confiable)" : e.bloqueado ? "Bloqueante" : e.advertencias.some((a) => a.severidad === "ERROR") ? "Con errores: corregir el archivo" : e.advertencias.some((a) => a.severidad === "DECISION") ? "Requiere decisión" : "OK"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </div>
    </details>
  );
}
