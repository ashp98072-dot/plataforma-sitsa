"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PreviaLote, ResultadoLote } from "@/lib/rrhh/vacaciones-reparacion-db";
import { MOTIVOS_REPARACION } from "@/lib/rrhh/vacaciones-reparacion-textos";

const dma = (iso: string | null | undefined) => {
  const p = String(iso ?? "").slice(0, 10).split("-");
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : "—";
};
const n2 = (n: number) => n.toFixed(2);
const resumenPeriodos = (ps: { anioLaboral: number | null; inicio: string; fin: string }[]) =>
  ps.length ? ps.map((p) => `${p.anioLaboral ?? "—"}: ${dma(p.inicio)} → ${dma(p.fin)}`).join(" · ") : "—";

const ESTADO_TXT = { ELEGIBLE: "ELEGIBLE", BLOQUEADO: "BLOQUEADO", SIN_CAMBIOS: "SIN CAMBIOS" } as const;
const ESTADO_COLOR = { ELEGIBLE: "text-emerald-300", BLOQUEADO: "text-red-300", SIN_CAMBIOS: "text-[var(--muted)]" } as const;
const RESULTADO_COLOR: Record<string, string> = { REPARADO: "text-emerald-300", BLOQUEADO: "text-red-300", CAMBIO_DESDE_PREVIEW: "text-amber-300", SIN_CAMBIOS: "text-[var(--muted)]", ERROR: "text-red-300" };

/**
 * REPARACIÓN POR LOTE de las series de vacaciones: «Revisar reparación de pendientes» solo ABRE una vista previa global (solo lectura). Únicamente
 * «Confirmar reparación de X colaboradores» escribe, y envía solo los ids y huellas de los ELEGIBLES vistos: el servidor repara a cada uno con la
 * reparación individual (su propia transacción), vuelve a validar todo y omite a quien haya cambiado o esté bloqueado.
 */
export function ReparacionLoteVacaciones({ slug, onCerrar, onTerminado }: { slug: string; onCerrar: () => void; onTerminado: () => void | Promise<void> }) {
  const [previa, setPrevia] = useState<PreviaLote | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [ejecutando, setEjecutando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoLote | null>(null);
  // nombres vistos en la vista previa (se conservan aunque, tras repararlos, ya no aparezcan en la vista previa actualizada)
  const [nombres, setNombres] = useState<Record<number, string>>({});
  const enCurso = useRef(false);
  const base = `/api/empresas/${slug}/rrhh/vacaciones/reparacion/lote`;

  const cargarPrevia = useCallback(async () => {
    setCargando(true);
    setError("");
    try {
      const res = await fetch(`${base}/preview`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setPrevia(null); setError(data.error ?? "No se pudo calcular la vista previa del lote."); return; }
      const lote = data as PreviaLote;
      setPrevia(lote);
      setNombres((anteriores) => ({ ...anteriores, ...Object.fromEntries(lote.filas.map((f) => [f.empleadoId, f.nombre])) }));
    } catch {
      setPrevia(null);
      setError("No se pudo calcular la vista previa del lote.");
    } finally {
      setCargando(false);
    }
  }, [base]);

  // La vista previa (solo lectura) se calcula al abrir el modal; NUNCA se ejecuta nada al abrirlo.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga remota (solo lectura) al abrir
    void cargarPrevia();
  }, [cargarPrevia]);

  const elegibles = previa?.filas.filter((f) => f.estado === "ELEGIBLE" && f.huella) ?? [];

  async function confirmar() {
    if (!previa || elegibles.length === 0 || enCurso.current) return;
    enCurso.current = true;
    setEjecutando(true);
    setError("");
    try {
      const res = await fetch(base, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmar: true, empleados: elegibles.map((f) => ({ empleadoId: f.empleadoId, huella: f.huella })) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error ?? "No se pudo ejecutar el lote. No se modificó nada."); return; }
      setResultado(data as ResultadoLote);
      await onTerminado(); // refresca pendientes, empleado seleccionado, saldo e historial
      await cargarPrevia(); // lo que quedó sin reparar (bloqueados / cambiados)
    } catch {
      setError("No se pudo ejecutar el lote. Revise el estado de los colaboradores.");
    } finally {
      enCurso.current = false;
      setEjecutando(false);
    }
  }

  const nombreDe = (id: number) => nombres[id] ?? `Colaborador #${id}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="Reparación de períodos de vacaciones por lote">
      <div className="max-h-[92vh] w-full max-w-6xl space-y-3 overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--card)] p-5 text-sm">
        <h2 className="text-base font-semibold">Reparación de períodos de vacaciones — pendientes de la empresa</h2>

        {cargando ? <p className="text-xs text-[var(--muted)]">Calculando vista previa…</p> : null}
        {error ? <p className="text-xs text-red-300" role="alert">{error}</p> : null}

        {resultado ? (
          <div className="space-y-2 rounded-lg border border-emerald-400/40 bg-emerald-400/5 p-3 text-xs" role="status">
            <p className="text-sm font-medium text-emerald-200">Resultado del lote</p>
            <p>
              Reparados correctamente: <strong>{resultado.reparados}</strong> · Bloqueados: <strong>{resultado.bloqueados}</strong> · Cambió desde vista previa: <strong>{resultado.cambiosDesdePreview}</strong> ·
              Ya no requerían reparación: <strong>{resultado.sinCambios}</strong> · Errores inesperados: <strong>{resultado.errores}</strong>
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="text-[var(--muted)]"><tr><th className="py-1 pr-3">Empleado</th><th className="pr-3">Resultado</th><th>Mensaje</th></tr></thead>
                <tbody>
                  {resultado.resultados.map((r) => (
                    <tr key={r.empleadoId} className="border-t border-[var(--border)] align-top">
                      <td className="py-1 pr-3">{nombreDe(r.empleadoId)}</td>
                      <td className={`pr-3 font-medium ${RESULTADO_COLOR[r.resultado] ?? ""}`}>{r.resultado}</td>
                      <td>{r.mensaje}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {previa ? (
          <>
            <p className="text-xs">
              {resultado ? "Estado actual — " : ""}Pendientes: <strong>{previa.pendientes}</strong> · Elegibles: <strong>{previa.elegibles}</strong> · Bloqueados: <strong>{previa.bloqueados}</strong> · Sin cambios: <strong>{previa.sinCambios}</strong>
            </p>
            {previa.filas.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="text-[var(--muted)]">
                    <tr>
                      <th className="py-1 pr-2">Empleado</th><th className="pr-2">Código</th><th className="pr-2">Fecha de contratación</th><th className="pr-2">Motivos actuales</th>
                      <th className="pr-2">Períodos actuales</th><th className="pr-2">Períodos propuestos</th><th className="pr-2 text-right">Saldo antes</th><th className="pr-2 text-right">Saldo después</th>
                      <th className="pr-2 text-right">Consumo preservado</th><th className="pr-2">Bloqueos</th><th>Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previa.filas.map((f) => (
                      <tr key={f.empleadoId} className="border-t border-[var(--border)] align-top">
                        <td className="py-1 pr-2 font-medium">{f.nombre}</td>
                        <td className="pr-2">{f.codigo || "—"}</td>
                        <td className="pr-2">{dma(f.fechaAlta)}</td>
                        <td className="pr-2">{f.motivos.map((m) => MOTIVOS_REPARACION[m] ?? m).join(", ") || "—"}</td>
                        <td className="pr-2">{resumenPeriodos(f.periodosActuales)}</td>
                        <td className="pr-2">{resumenPeriodos(f.periodosPropuestos)}</td>
                        <td className="pr-2 text-right">{n2(f.saldoAntes)}</td>
                        <td className="pr-2 text-right">{n2(f.saldoDespues)}</td>
                        <td className="pr-2 text-right">{n2(f.consumidoPreservado)}</td>
                        <td className="pr-2 text-red-300">{f.bloqueos.length ? <>No reparado — requiere revisión manual: {f.bloqueos.map((b) => b.mensaje).join(" ")}</> : "—"}</td>
                        <td className={`font-medium ${ESTADO_COLOR[f.estado]}`}>{ESTADO_TXT[f.estado]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="text-xs text-[var(--muted)]">No hay colaboradores pendientes de reparación.</p>}

            {elegibles.length > 0 ? (
              <p className="rounded border border-amber-400/40 bg-amber-400/10 p-2 text-xs text-amber-200">
                Se reconstruirán los períodos de vacaciones de {elegibles.length} colaborador(es) usando la fecha de contratación actual de cada uno.
                No se modifica la fecha de contratación. No se modifican incidencias, vacaciones ni evidencias. Los colaboradores bloqueados no serán modificados.
              </p>
            ) : null}
          </>
        ) : null}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onCerrar} disabled={ejecutando} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs">
            {resultado ? "Cerrar" : "Cancelar"}
          </button>
          {elegibles.length > 0 ? (
            <button
              type="button"
              onClick={() => void confirmar()}
              disabled={ejecutando || cargando}
              className="rounded-lg bg-amber-400 px-3 py-1.5 text-xs font-semibold text-black disabled:cursor-not-allowed disabled:opacity-40"
            >
              {ejecutando ? "Reparando…" : `Confirmar reparación de ${elegibles.length} colaboradores`}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
