"use client";

import { useCallback, useEffect, useState } from "react";
import type { ResultadoPreflight } from "@/lib/rrhh/vacaciones-modo-preflight";

/** Aviso visible mientras la empresa tiene activo el historial completo de vacaciones (presentacional). No habla de saldo «temporal» ni de desactivar. */
export function AvisoHistorialCompletoVacaciones() {
  return (
    <div className="rounded-xl border-2 border-amber-400 bg-amber-400/10 p-4" role="status">
      <p className="text-base font-bold tracking-wide text-amber-300">HISTORIAL COMPLETO DE VACACIONES ACTIVO</p>
      <p className="mt-1 text-sm text-amber-100">
        El saldo incluye todos los períodos acumulados desde la fecha de contratación, descontando las vacaciones registradas.
      </p>
    </div>
  );
}

/**
 * Historial completo de vacaciones (por empresa). Con la empresa en este modo solo se muestra el aviso: la interfaz NO ofrece desactivar ni recalcular (el backend sigue siendo
 * reversible para un administrador técnico). Para una empresa que aún no lo tiene, quien tiene permiso de administración (RRHH · Configuración · editar) puede activarlo
 * tras la verificación previa (preflight de solo lectura) y una confirmación explícita; el servidor vuelve a exigir permiso y verificación.
 */
export function ModoCargaHistoricaVacaciones({ slug, puedeCambiar, onCambio, onModo }: { slug: string; puedeCambiar: boolean; onCambio: () => void | Promise<void>; onModo?: (activo: boolean) => void }) {
  const [activo, setActivo] = useState<boolean | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState("");
  // Verificación previa (solo lectura) que se muestra ANTES de confirmar la activación
  const [preflight, setPreflight] = useState<ResultadoPreflight | null>(null);
  const [verificando, setVerificando] = useState(false);
  const base = `/api/empresas/${slug}/rrhh/vacaciones/modo-carga-historica`;

  const cargar = useCallback(async () => {
    try {
      const res = await fetch(base, { cache: "no-store" });
      if (!res.ok) return;
      const d = (await res.json()) as { activo: boolean };
      setActivo(d.activo);
      onModo?.(d.activo);
    } catch {
      /* el aviso es informativo: sin respuesta no se muestra */
    }
  }, [base, onModo]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga remota (solo lectura) al abrir
    void cargar();
  }, [cargar]);

  async function pedirActivar() {
    setConfirmando(true);
    setPreflight(null);
    setError("");
    setVerificando(true);
    try {
      const res = await fetch(`${base}/preflight`, { cache: "no-store" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setError(d.error ?? "No se pudo verificar el consumo histórico. No se puede activar."); return; }
      setPreflight(d as ResultadoPreflight);
    } catch {
      setError("No se pudo verificar el consumo histórico. No se puede activar.");
    } finally {
      setVerificando(false);
    }
  }

  async function activar() {
    if (trabajando) return;
    setTrabajando(true);
    setError("");
    try {
      const res = await fetch(base, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ activo: true, confirmar: true }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (d.codigo === "PREFLIGHT_BLOQUEADO") { setPreflight(d as ResultadoPreflight); return; } // el servidor volvió a verificar y hay consumo no verificable
        setError(d.error ?? "No se pudo activar.");
        return;
      }
      setActivo(d.activo as boolean);
      onModo?.(d.activo as boolean);
      setConfirmando(false);
      await onCambio();
    } catch {
      setError("No se pudo completar la operación. No se modificó nada.");
    } finally {
      setTrabajando(false);
    }
  }

  return (
    <div className="space-y-2">
      {activo ? <AvisoHistorialCompletoVacaciones /> : null}

      {!activo && activo !== null && puedeCambiar ? (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-[var(--muted)]">Historial completo de vacaciones (todos los períodos acumulados desde la fecha de contratación):</span>
          <strong>no activo</strong>
          <button type="button" onClick={() => void pedirActivar()} disabled={trabajando || verificando} className="rounded border border-amber-400/60 px-2 py-0.5 text-amber-200 hover:bg-amber-400/10">
            Activar
          </button>
        </div>
      ) : null}

      {confirmando && !activo ? (
        <div className="space-y-2 rounded-lg border border-amber-400/60 bg-[var(--card)] p-3 text-xs" role="dialog" aria-label="Confirmar activación">
          <p>
            Activar el historial completo hace que todos los períodos acumulados desde la fecha de contratación se consideren disponibles (sin el límite de 2 períodos / 30 días),
            descontando las vacaciones registradas. No borra ni modifica vacaciones, incidencias ni evidencias.
          </p>
          <div className="space-y-1 rounded border border-[var(--border)] p-2">
            {verificando || !preflight ? <p className="text-[var(--muted)]">{verificando ? "Verificando el consumo histórico…" : "Sin verificación previa."}</p> : (
              <>
                <p className="font-medium">Verificación previa:</p>
                <p>{preflight.revisados} colaboradores revisados · {preflight.aptos} aptos · {preflight.bloqueados} con consumo no verificable</p>
                {preflight.bloqueados > 0 ? (
                  <div className="space-y-1 text-red-300" role="alert">
                    <p>No se puede activar el modo histórico todavía. Hay {preflight.bloqueados} colaboradores con consumo que no puede reconstruirse de forma verificable.</p>
                    <ul className="list-disc space-y-1 pl-5">
                      {preflight.motivos.map((m) => (
                        <li key={m.empleadoId}><strong>{m.nombre}</strong>{m.codigo ? ` (${m.codigo})` : ""}: {m.motivos.map((x) => x.mensaje).join(" ")}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </>
            )}
          </div>
          <div className="flex gap-2">
            {preflight?.puedeActivar ? (
              <button type="button" onClick={() => void activar()} disabled={trabajando || verificando} className="rounded bg-amber-400 px-3 py-1 font-semibold text-black disabled:opacity-40">
                {trabajando ? "Procesando…" : "Confirmar activación"}
              </button>
            ) : null}
            <button type="button" onClick={() => setConfirmando(false)} disabled={trabajando} className="rounded border border-[var(--border)] px-3 py-1">Cancelar</button>
          </div>
        </div>
      ) : null}

      {error ? <p className="text-xs text-red-300" role="alert">{error}</p> : null}
    </div>
  );
}
