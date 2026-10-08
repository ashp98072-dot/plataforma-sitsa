"use client";

import { useCallback, useEffect, useState } from "react";
import type { ResultadoResync } from "@/lib/rrhh/vacaciones-modo-resync-db";
import type { ResultadoPreflight } from "@/lib/rrhh/vacaciones-modo-preflight";

type Accion = "activar" | "desactivar" | "resincronizar" | null;

/**
 * MODO DE CARGA HISTÓRICA de vacaciones (temporal, por empresa). Mientras está activo se muestra un aviso MUY visible: todos los períodos históricos no consumidos se consideran
 * disponibles y el límite normal de 2 períodos / 30 días está suspendido. Activar, desactivar y resincronizar requieren confirmación explícita (solo con permiso de
 * administración RRHH · Configuración · editar; el servidor lo vuelve a exigir). Cambiar el modo solo cambia una bandera: no borra ni modifica vacaciones, incidencias ni evidencias.
 */
export function ModoCargaHistoricaVacaciones({ slug, puedeCambiar, onCambio, onModo }: { slug: string; puedeCambiar: boolean; onCambio: () => void | Promise<void>; onModo?: (activo: boolean) => void }) {
  const [activo, setActivo] = useState<boolean | null>(null);
  const [confirmar, setConfirmar] = useState<Accion>(null);
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");
  const [resync, setResync] = useState<ResultadoResync | null>(null);
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
    setConfirmar("activar");
    setPreflight(null);
    setError("");
    setAviso("");
    setVerificando(true);
    try {
      const res = await fetch(`${base}/preflight`, { cache: "no-store" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setError(d.error ?? "No se pudo verificar el consumo histórico. No se puede activar el modo."); return; }
      setPreflight(d as ResultadoPreflight);
    } catch {
      setError("No se pudo verificar el consumo histórico. No se puede activar el modo.");
    } finally {
      setVerificando(false);
    }
  }

  async function ejecutar(accion: Exclude<Accion, null>) {
    if (trabajando) return;
    setTrabajando(true);
    setError("");
    setAviso("");
    try {
      if (accion === "resincronizar") {
        const res = await fetch(`${base}/resincronizar`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmar: true }) });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) { setError(d.error ?? "No se pudo resincronizar."); return; }
        setResync(d as ResultadoResync);
      } else {
        const res = await fetch(base, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ activo: accion === "activar", confirmar: true }) });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (d.codigo === "PREFLIGHT_BLOQUEADO") { setPreflight(d as ResultadoPreflight); setError(""); return; } // el servidor volvió a verificar y hay consumo no verificable
          setError(d.error ?? "No se pudo cambiar el modo.");
          return;
        }
        setActivo(d.activo as boolean);
        onModo?.(d.activo as boolean);
        setResync(null);
        setAviso(d.cambiado ? "Modo actualizado. Para que los saldos guardados de todos los colaboradores reflejen el modo ahora, use «Recalcular saldos»; de lo contrario se actualizan al consultar a cada colaborador." : "El modo ya tenía ese valor: no se modificó nada.");
      }
      setConfirmar(null);
      await onCambio();
    } catch {
      setError("No se pudo completar la operación. No se modificó nada.");
    } finally {
      setTrabajando(false);
    }
  }

  const TEXTO: Record<Exclude<Accion, null>, string> = {
    activar: "Activar el modo de carga histórica suspende temporalmente el vencimiento y el límite de 2 períodos / 30 días para esta empresa: todos los períodos históricos no consumidos se mostrarán como disponibles. No borra ni modifica vacaciones, incidencias ni evidencias.",
    desactivar: "Al volver al modo normal se reaplicará el vencimiento y el límite de períodos vigentes. Los consumos históricos se conservarán.",
    resincronizar: "Se recalcularán los saldos guardados de cada colaborador (uno por uno, cada uno en su propia transacción) con el modo vigente. No se borra historial ni se crea ninguna vacación o incidencia; la sincronización normal puede completar períodos faltantes. Un colaborador con consumo no verificable no se recalcula.",
  };

  return (
    <div className="space-y-2">
      {activo ? (
        <div className="rounded-xl border-2 border-amber-400 bg-amber-400/10 p-4" role="alert">
          <p className="text-base font-bold tracking-wide text-amber-300">MODO DE CARGA HISTÓRICA ACTIVO</p>
          <p className="mt-1 text-sm text-amber-100">
            Todos los períodos históricos no consumidos se consideran disponibles temporalmente. El límite normal de 2 períodos / 30 días está suspendido durante la carga histórica.
          </p>
          <p className="mt-1 text-xs text-amber-200">Este saldo es TEMPORAL: no es el saldo normal.</p>
        </div>
      ) : null}

      {puedeCambiar && activo !== null ? (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-[var(--muted)]">Modo de carga histórica de vacaciones:</span>
          <strong>{activo ? "ACTIVO" : "normal"}</strong>
          <button type="button" onClick={() => (activo ? setConfirmar("desactivar") : void pedirActivar())} disabled={trabajando} className="rounded border border-amber-400/60 px-2 py-0.5 text-amber-200 hover:bg-amber-400/10">
            {activo ? "Desactivar" : "Activar"}
          </button>
          <button type="button" onClick={() => setConfirmar("resincronizar")} disabled={trabajando} className="rounded border border-[var(--border)] px-2 py-0.5">
            Recalcular saldos
          </button>
        </div>
      ) : null}

      {confirmar ? (
        <div className="space-y-2 rounded-lg border border-amber-400/60 bg-[var(--card)] p-3 text-xs" role="dialog" aria-label="Confirmar cambio de modo">
          <p>{TEXTO[confirmar]}</p>
          {confirmar === "activar" ? (
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
          ) : null}
          <div className="flex gap-2">
            {confirmar !== "activar" || preflight?.puedeActivar ? (
            <button type="button" onClick={() => void ejecutar(confirmar)} disabled={trabajando || verificando} className="rounded bg-amber-400 px-3 py-1 font-semibold text-black disabled:opacity-40">
              {trabajando ? "Procesando…" : confirmar === "activar" ? "Confirmar activación" : confirmar === "desactivar" ? "Confirmar desactivación" : "Confirmar recálculo"}
            </button>
            ) : null}
            <button type="button" onClick={() => setConfirmar(null)} disabled={trabajando} className="rounded border border-[var(--border)] px-3 py-1">Cancelar</button>
          </div>
        </div>
      ) : null}

      {error ? <p className="text-xs text-red-300" role="alert">{error}</p> : null}
      {aviso ? <p className="text-xs text-emerald-300" role="status">{aviso}</p> : null}
      {resync ? (
        <p className="text-xs text-emerald-300" role="status">
          Saldos recalculados: {resync.sincronizados} de {resync.total} colaborador(es) · congelados (requieren reparación): {resync.congelados} · consumo no verificable (no recalculados): {resync.consumoNoVerificable} · errores: {resync.errores}.
        </p>
      ) : null}
    </div>
  );
}
