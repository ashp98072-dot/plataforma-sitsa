"use client";

import { useState } from "react";
import type { ResultadoPreviewActual } from "@/lib/rrhh/vacaciones-historial-actual";
import { VistaPreviaHistorial } from "./vista-previa-historial-vacaciones";

/**
 * Exportar historial actual — descarga las vacaciones registradas hoy en el formato de «Importar historial (solo vista previa)» y
 * permite previsualizarlas con el mismo motor. SOLO LECTURA: no modifica ningún dato. No existe aquí ninguna acción de limpieza.
 */
export function ExportarHistorialVacaciones({ slug }: { slug: string }) {
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");
  const [resultado, setResultado] = useState<ResultadoPreviewActual | null>(null);
  const base = `/api/empresas/${slug}/rrhh/vacaciones/exportar-historial`;

  async function previsualizar() {
    setCargando(true); setError(""); setResultado(null);
    try {
      const res = await fetch(`${base}/preview`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) setError(data.error ?? "No se pudo generar la vista previa.");
      else setResultado(data as ResultadoPreviewActual);
    } catch {
      setError("No se pudo generar la vista previa.");
    } finally {
      setCargando(false);
    }
  }

  const ex = resultado?.exportacion;
  return (
    <details className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 text-sm">
      <summary className="cursor-pointer font-medium">Exportar historial actual</summary>
      <div className="mt-3 space-y-3">
        <p className="text-xs text-[var(--muted)]">
          Descarga las vacaciones registradas hoy (código, DPI, nombre, fechas, días, tipo y observación) en el formato exacto de
          «Importar historial (solo vista previa)», para revisarlas y volver a subirlas sin transformar. No incluye saldos ni detalle FIFO.
          Las vacaciones cuyo tipo no pueda resolverse con certeza <strong>no salen en el archivo</strong> y se listan como problema.
          Esta opción <strong>solo lee</strong>: no modifica ni elimina ningún dato.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <a href={`${base}?formato=xlsx`} className="rounded bg-[var(--accent)] px-3 py-1.5 text-white" download>Descargar XLSX</a>
          <a href={`${base}?formato=csv`} className="rounded border border-[var(--border)] px-3 py-1.5" download>Descargar CSV</a>
          <button type="button" disabled={cargando} onClick={() => void previsualizar()} className="rounded border border-[var(--border)] px-3 py-1.5 disabled:opacity-50">
            {cargando ? "Analizando…" : "Previsualizar historial actual"}
          </button>
        </div>
        {error ? <p className="text-red-300">{error}</p> : null}

        {resultado && ex ? (
          <div className="space-y-4">
            <p className={`rounded border p-2 text-xs ${ex.resumen.completo ? "border-emerald-400/40 text-emerald-200" : "border-red-400/40 text-red-200"}`}>
              {ex.resumen.completo
                ? `Las ${ex.resumen.vacacionesLeidas} vacaciones actuales se pueden exportar con tipo resuelto.`
                : `${ex.resumen.filasNoExportadas} de ${ex.resumen.vacacionesLeidas} vacaciones NO se pueden exportar con certeza (${ex.resumen.problemasError} problema(s) administrativo(s)). Corríjalos antes de limpiar el módulo.`}
              {" "}No se escribió nada.
            </p>
            {ex.problemas.length ? (
              <div>
                <h3 className="mb-1 text-xs font-semibold uppercase text-[var(--muted)]">Emparejamiento vacaciones ↔ incidencias ({ex.problemas.length})</h3>
                <ul className="max-h-60 space-y-1 overflow-y-auto text-xs">
                  {ex.problemas.map((p, i) => (
                    <li key={`${p.codigo}-${i}`} className={p.severidad === "ERROR" ? "text-red-300" : "text-amber-200"}>
                      <strong>{p.severidad === "ERROR" ? "Error" : "Advertencia"}</strong> · {p.codigo}: {p.mensaje}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <VistaPreviaHistorial preview={resultado.preview} />
          </div>
        ) : null}
      </div>
    </details>
  );
}
