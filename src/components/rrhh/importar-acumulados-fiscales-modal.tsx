"use client";

import { useRef, useState } from "react";
import { hoyLocal } from "@/lib/rrhh/dates";
import { unaSolaVez } from "@/lib/rrhh/fiscal-migracion-ui";
import {
  analizarArchivo,
  cantidadAImportar,
  formatoTamano,
  importarArchivo,
  MAX_BYTES_ACUMULADOS,
  puedeImportar,
  TEXTO_PASO_PLANTILLA,
  textoConfirmacionImportacion,
  textoExito,
  urlPlantilla,
  type ResultadoAnalisis,
} from "@/lib/rrhh/fiscal-importacion-ui";

/**
 * IMPORTAR ACUMULADOS FISCALES (Excel): 1) descargar plantilla · 2) seleccionar archivo · 3) analizar (dry-run, no guarda) ·
 * vista previa · importar como BORRADORES (todo o nada, nunca confirma). Con al menos una fila con error, importar se bloquea.
 * El servidor vuelve a analizar el archivo al importar: la vista previa no es la autoridad.
 */
const dinero = (v: string | null) => (v == null ? "—" : `Q${Number(v).toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const dma = (v: string | null) => (v ? v.split("-").reverse().join("/") : "—");
const COLOR = { VALIDA: "text-emerald-300", ADVERTENCIA: "text-amber-300", ERROR: "text-red-300" } as const;

export function ImportarAcumuladosFiscalesModal({ slug, onClose, onImportado }: { slug: string; onClose: () => void; onImportado?: () => void }) {
  const [ejercicio, setEjercicio] = useState(Number(hoyLocal().slice(0, 4)));
  const [archivo, setArchivo] = useState<File | null>(null);
  const [analisis, setAnalisis] = useState<ResultadoAnalisis | null>(null);
  const [error, setError] = useState("");
  const [exito, setExito] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [abiertas, setAbiertas] = useState<Set<number>>(new Set());
  const candado = useRef(false);

  function elegir(f: File | null) {
    setError(""); setExito(""); setAnalisis(null); setConfirmando(false);
    if (f && !/\.xlsx$/i.test(f.name)) { setArchivo(null); setError("Solo se aceptan archivos .xlsx."); return; }
    if (f && f.size > MAX_BYTES_ACUMULADOS) { setArchivo(null); setError("El archivo excede el tamaño máximo de 5 MB."); return; }
    setArchivo(f);
  }

  async function analizar() {
    if (!archivo) return;
    const r = await unaSolaVez(candado, async () => { setOcupado(true); try { return await analizarArchivo((u, i) => fetch(u, i), slug, archivo, archivo.name); } finally { setOcupado(false); } });
    if (r === null) return;
    setExito("");
    if (r.tipo === "error") { setError(r.error); setAnalisis(null); return; }
    setError("");
    setAnalisis(r.analisis);
  }

  async function importar() {
    if (!archivo || !puedeImportar(analisis)) return;
    const r = await unaSolaVez(candado, async () => { setOcupado(true); try { return await importarArchivo((u, i) => fetch(u, i), slug, archivo, archivo.name); } finally { setOcupado(false); } });
    if (r === null) return;
    setConfirmando(false);
    if (r.tipo === "error") { setError(r.error); if (r.analisis) setAnalisis(r.analisis); return; } // la vista previa se conserva
    setError("");
    setAnalisis(null);
    setArchivo(null);
    setExito(textoExito(r.importados));
    onImportado?.();
  }

  const n = analisis ? cantidadAImportar(analisis) : 0;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="Importar acumulados fiscales">
      <div className="max-h-[90vh] w-full max-w-4xl space-y-4 overflow-auto rounded-xl border border-[var(--border)] bg-[var(--card)] p-5 text-sm">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-semibold">Importar acumulados fiscales</h2>
          <button type="button" className="rounded border border-[var(--border)] px-2 py-1" onClick={onClose} disabled={ocupado}>Cerrar</button>
        </div>

        <section className="space-y-2">
          <h3 className="font-medium">Paso 1 · Descargar plantilla</h3>
          <p className="text-xs text-[var(--muted)]">{TEXTO_PASO_PLANTILLA}</p>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-[var(--muted)]">Ejercicio
              <input type="number" className="mt-1 block w-24 rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1" value={ejercicio} min={2000} max={9999} onChange={(e) => setEjercicio(Number(e.target.value))} />
            </label>
            <a className="rounded bg-[#334155] px-3 py-1.5 text-white" href={urlPlantilla(slug, ejercicio)} download>Descargar plantilla</a>
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="font-medium">Paso 2 · Seleccionar archivo</h3>
          <input type="file" accept=".xlsx" disabled={ocupado} onChange={(e) => elegir(e.target.files?.[0] ?? null)} aria-label="Archivo Excel de acumulados" />
          {archivo ? <p className="text-xs text-[var(--muted)]">{archivo.name} · {formatoTamano(archivo.size)}</p> : null}
        </section>

        <section className="space-y-2">
          <h3 className="font-medium">Paso 3 · Analizar</h3>
          <button type="button" className="rounded bg-[var(--accent)] px-3 py-1.5 text-white disabled:opacity-50" disabled={!archivo || ocupado} onClick={() => void analizar()}>
            {ocupado && !confirmando ? "Procesando…" : "Analizar archivo"}
          </button>
        </section>

        {error ? <p role="alert" className="text-red-300">{error}</p> : null}
        {exito ? <p role="status" className="rounded border border-emerald-700/60 bg-emerald-900/20 px-3 py-2 text-emerald-300">{exito}</p> : null}

        {analisis ? (
          <section className="space-y-3" aria-label="Vista previa">
            <p aria-live="polite">
              Total filas: <strong>{analisis.totalFilas}</strong> · Válidas: <strong className="text-emerald-300">{analisis.validas}</strong> · Con advertencias:{" "}
              <strong className="text-amber-300">{analisis.advertencias}</strong> · Con errores: <strong className="text-red-300">{analisis.errores}</strong>
              {analisis.omitidasSinDatos ? <span className="text-[var(--muted)]"> · Omitidas sin datos: {analisis.omitidasSinDatos}</span> : null}
            </p>
            <div className="overflow-x-auto rounded border border-[var(--border)]">
              <table className="w-full text-left text-xs">
                <thead className="bg-[var(--thead)] text-[var(--muted)]">
                  <tr>{["Fila", "Empleado", "Corte", "Gravado", "Exento", "IGSS", "ISR", "Estado"].map((h) => <th key={h} className="px-2 py-1.5">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {analisis.filas.map((f) => (
                    <tr key={f.numeroFila} className="border-t border-[var(--border)] align-top" data-estado={f.estado}>
                      <td className="px-2 py-1.5">{f.numeroFila}</td>
                      <td className="px-2 py-1.5">{f.codigo} — {f.nombre}</td>
                      <td className="px-2 py-1.5">{dma(f.fechaCorte)}</td>
                      <td className="px-2 py-1.5">{dinero(f.gravado)}</td>
                      <td className="px-2 py-1.5">{dinero(f.exento)}</td>
                      <td className="px-2 py-1.5">{dinero(f.igss)}</td>
                      <td className="px-2 py-1.5">{dinero(f.isr)}</td>
                      <td className="px-2 py-1.5">
                        <span className={COLOR[f.estado]}>{f.estado === "VALIDA" ? "Válida" : f.estado === "ADVERTENCIA" ? "Advertencia" : "Error"}</span>
                        {f.mensajes.length ? (
                          <>
                            <button type="button" className="ml-2 underline" aria-expanded={abiertas.has(f.numeroFila)}
                              onClick={() => setAbiertas((s) => { const x = new Set(s); if (x.has(f.numeroFila)) x.delete(f.numeroFila); else x.add(f.numeroFila); return x; })}>
                              {abiertas.has(f.numeroFila) ? "Ocultar" : `Ver ${f.mensajes.length} mensaje(s)`}
                            </button>
                            {abiertas.has(f.numeroFila) ? <ul className="mt-1 list-disc space-y-0.5 pl-4">{f.mensajes.map((m, i) => <li key={i}>{m}</li>)}</ul> : null}
                          </>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {analisis.errores > 0 ? <p className="text-xs text-red-300">Hay filas con error: corrige el Excel y vuelve a subirlo. No se puede importar hasta que no haya errores.</p> : null}
            <button type="button" className="rounded bg-emerald-700 px-3 py-1.5 text-white disabled:opacity-50" disabled={!puedeImportar(analisis) || ocupado} onClick={() => setConfirmando(true)}>
              Importar y guardar como borradores
            </button>
          </section>
        ) : null}

        {confirmando && analisis ? (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="Confirmar importación">
            <div className="w-full max-w-md space-y-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
              <p>{textoConfirmacionImportacion(n)}</p>
              <div className="flex justify-end gap-2">
                <button type="button" className="rounded border border-[var(--border)] px-3 py-1.5" disabled={ocupado} onClick={() => setConfirmando(false)}>Cancelar</button>
                <button type="button" className="rounded bg-emerald-700 px-3 py-1.5 text-white disabled:opacity-50" disabled={ocupado} onClick={() => void importar()}>
                  {ocupado ? "Importando…" : `Importar ${n} borradores`}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
