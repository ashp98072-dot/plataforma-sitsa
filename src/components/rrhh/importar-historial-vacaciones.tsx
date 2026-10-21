"use client";

import { useState } from "react";
import type { ResultadoPreview } from "@/lib/rrhh/vacaciones-historial-preview";
import { VistaPreviaHistorial } from "./vista-previa-historial-vacaciones";

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

        {preview ? <VistaPreviaHistorial preview={preview} /> : null}
      </div>
    </details>
  );
}
