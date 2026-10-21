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

/** Resultado de una vista previa del historial (errores/advertencias, resumen y saldo final simulado). Solo muestra: no escribe nada. */
export function VistaPreviaHistorial({ preview }: { preview: ResultadoPreview }) {
  const r = preview.resumen;
  return (
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
  );
}
