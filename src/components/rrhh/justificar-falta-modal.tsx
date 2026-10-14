"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  MOTIVO_REVERSION_MIN,
  OBSERVACION_JUSTIFICACION_MAX,
  TIPOS_JUSTIFICACION,
  type EstadoJustificacion,
} from "@/lib/rrhh/justificaciones-faltas-shared";

/**
 * RRHH → Reportes de asistencia — modal de justificación de una FALTA (se abre con doble clic sobre la fila o con el botón
 * «Justificar»). Solo presentación: las reglas (que el día sea una falta real, tenant, permisos, versión, auditoría) las decide
 * el servidor. Justificar NO crea marcajes ni cambia la ausencia: solo la marca como «Falta justificada».
 */

type Justificacion = {
  id: number;
  tipo: string;
  observacion: string | null;
  estado: EstadoJustificacion;
  version: number;
  creadoPor: string;
  creadoEn: string;
  actualizadoPor: string | null;
  actualizadoEn: string | null;
  revertidoPor: string | null;
  revertidoEn: string | null;
  motivoReversion: string | null;
};
type Evidencia = { id: number; nombre: string | null; subidoEn: string; subidoPor: string | null };
type Contexto = {
  empleado: { id: number; codigo: string; nombre: string };
  fecha: string;
  estadoActual: string;
  justificable: boolean;
  justificacion: Justificacion | null;
  planilla: { ausenciaConfirmada: boolean; aplicadaEnPlanilla: boolean };
  evidencias: Evidencia[];
};

const inputCls = "rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1.5 text-sm text-[var(--text)]";
const EXT_ACEPTADAS = ".jpg,.jpeg,.png,.webp,.pdf";

export function JustificarFaltaModal({
  slug, empleadoId, codigo, nombre, fecha, fechaUi, estadoActual, puedeCrear, puedeEditar, onClose, onCambio,
}: {
  slug: string;
  empleadoId: number;
  codigo: string;
  nombre: string;
  fecha: string;
  fechaUi: string;
  estadoActual: string;
  /** Permiso `incidencias:crear` (justificar). El servidor lo vuelve a exigir. */
  puedeCrear: boolean;
  /** Permiso `incidencias:editar` (editar, revertir, evidencias). El servidor lo vuelve a exigir. */
  puedeEditar: boolean;
  onClose: () => void;
  onCambio: () => void;
}) {
  const [ctx, setCtx] = useState<Contexto | null>(null);
  const [errorLectura, setErrorLectura] = useState("");
  const [error, setError] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [enviando, setEnviando] = useState(false);
  const ocupadoRef = useRef(false); // candado síncrono: el doble clic rápido no envía dos veces
  const [tipo, setTipo] = useState("");
  const [observacion, setObservacion] = useState("");
  const [motivo, setMotivo] = useState("");
  const [revirtiendo, setRevirtiendo] = useState(false);

  const base = `/api/empresas/${slug}/rrhh/justificaciones-faltas`;

  const cargar = useCallback(async () => {
    try {
      const res = await fetch(`${base}?${new URLSearchParams({ empleadoId: String(empleadoId), fecha })}`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorLectura(data.error ?? "No se pudo leer la justificación.");
        return;
      }
      setErrorLectura("");
      const c = data as Contexto;
      setCtx(c);
      const j = c.justificacion?.estado === "ACTIVA" ? c.justificacion : null;
      setTipo(j?.tipo ?? "");
      setObservacion(j?.observacion ?? "");
    } catch {
      setErrorLectura("Error de conexión.");
    }
  }, [base, empleadoId, fecha]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial del modal
    void cargar();
  }, [cargar]);

  async function enviar(url: string, metodo: "POST" | "PATCH", cuerpo: unknown | FormData): Promise<boolean> {
    if (ocupadoRef.current) return false;
    ocupadoRef.current = true;
    setEnviando(true);
    setError("");
    setMensaje("");
    try {
      const esForm = cuerpo instanceof FormData;
      const res = await fetch(url, {
        method: metodo,
        headers: esForm ? undefined : { "Content-Type": "application/json" },
        body: esForm ? cuerpo : JSON.stringify(cuerpo),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "No se pudo completar la operación.");
        if (res.status === 409) await cargar();
        return false;
      }
      setMensaje(data.mensaje ?? "Listo.");
      await cargar();
      onCambio();
      return true;
    } catch {
      setError("Error de conexión.");
      return false;
    } finally {
      ocupadoRef.current = false;
      setEnviando(false);
    }
  }

  const j = ctx?.justificacion?.estado === "ACTIVA" ? ctx.justificacion : null;
  const revertida = ctx?.justificacion?.estado === "REVERTIDA" ? ctx.justificacion : null;
  const esFalta = ctx?.justificable === true;

  async function justificar(e: React.FormEvent) {
    e.preventDefault();
    await enviar(base, "POST", { empleadoId, fecha, tipo, observacion: observacion.trim() || null });
  }
  async function guardarCambios(e: React.FormEvent) {
    e.preventDefault();
    if (!j) return;
    await enviar(base, "PATCH", { id: j.id, expectedVersion: j.version, tipo, observacion: observacion.trim() || null });
  }
  async function revertir() {
    if (!j) return;
    const ok = await enviar(`${base}/${j.id}/revertir`, "POST", { expectedVersion: j.version, motivo });
    if (ok) {
      setRevirtiendo(false);
      setMotivo("");
    }
  }
  async function adjuntar(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const form = new FormData();
    form.set("empleadoId", String(empleadoId));
    form.set("fecha", fecha);
    form.set("file", file);
    await enviar(`${base}/evidencias`, "POST", form);
  }
  async function quitarEvidencia(id: number) {
    if (ocupadoRef.current) return;
    ocupadoRef.current = true;
    setEnviando(true);
    setError("");
    try {
      const res = await fetch(`${base}/evidencias/${id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setError(data.error ?? "No se pudo eliminar la evidencia.");
      else await cargar();
    } finally {
      ocupadoRef.current = false;
      setEnviando(false);
    }
  }

  const puedeEscribirNueva = puedeCrear && esFalta && !j;

  return (
    <div role="dialog" aria-modal="true" aria-label={`Justificar falta de ${nombre}`} className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="max-h-[90vh] w-full max-w-lg space-y-3 overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 text-sm text-[var(--text)]">
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-base font-semibold">{j ? "Falta justificada" : "Justificar falta"}</h2>
          <button type="button" onClick={onClose} className="rounded border border-[var(--border)] px-2 py-1 text-xs">Cerrar</button>
        </div>

        <ul className="space-y-0.5 text-xs">
          <li><span className="text-[var(--muted)]">Empleado: </span>{nombre}</li>
          <li><span className="text-[var(--muted)]">Código: </span><span className="font-mono">{codigo}</span></li>
          <li><span className="text-[var(--muted)]">Fecha: </span>{fechaUi}</li>
          <li><span className="text-[var(--muted)]">Estado actual: </span><strong>{ctx?.estadoActual ?? estadoActual}</strong></li>
        </ul>

        {!ctx && !errorLectura ? <p className="text-xs text-[var(--muted)]">Cargando…</p> : null}
        {errorLectura ? <p role="alert" className="text-xs text-rose-400">{errorLectura}</p> : null}
        {error ? <p role="alert" className="text-xs text-rose-400">{error}</p> : null}
        {mensaje ? <p role="status" className="text-xs text-emerald-300">{mensaje}</p> : null}

        {ctx && !esFalta ? (
          <p className="text-xs text-amber-300">Este día no es una falta; no se puede justificar.</p>
        ) : null}

        {ctx?.planilla.ausenciaConfirmada ? (
          <p className="rounded border border-amber-700/60 bg-amber-900/20 px-2 py-1 text-xs text-amber-300">
            Esta falta tiene una ausencia confirmada para planilla{ctx.planilla.aplicadaEnPlanilla ? " ya aplicada a un período" : ""}.
            Justificarla NO modifica ese descuento automáticamente: la justificación solo identifica la falta como justificada.
          </p>
        ) : null}

        {j ? (
          <section className="space-y-2" aria-label="Justificación vigente">
            <ul className="space-y-0.5 text-xs">
              <li><span className="text-[var(--muted)]">Justificada por: </span>{j.creadoPor} · {j.creadoEn}</li>
              {j.actualizadoPor ? <li><span className="text-[var(--muted)]">Actualizada por: </span>{j.actualizadoPor} · {j.actualizadoEn}</li> : null}
            </ul>
            <form onSubmit={guardarCambios} className="space-y-2">
              <label className="flex flex-col gap-0.5 text-xs">
                Tipo / motivo
                <select className={inputCls} value={tipo} disabled={!puedeEditar || enviando} onChange={(e) => setTipo(e.target.value)}>
                  {TIPOS_JUSTIFICACION.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-0.5 text-xs">
                Observación
                <textarea className={inputCls} rows={2} maxLength={OBSERVACION_JUSTIFICACION_MAX} value={observacion} disabled={!puedeEditar || enviando} onChange={(e) => setObservacion(e.target.value)} />
              </label>
              {puedeEditar ? (
                <div className="flex flex-wrap gap-2">
                  <button type="submit" disabled={enviando || !tipo} className="rounded bg-emerald-700 px-3 py-1.5 text-xs text-white disabled:opacity-40">Guardar cambios</button>
                  <button type="button" disabled={enviando} onClick={() => setRevirtiendo(true)} className="rounded border border-rose-700/60 px-3 py-1.5 text-xs text-rose-300 disabled:opacity-40">Revertir justificación</button>
                </div>
              ) : (
                <p className="text-xs text-[var(--muted)]">Solo lectura: no tienes permiso para editar justificaciones.</p>
              )}
            </form>

            {revirtiendo ? (
              <div className="space-y-1 rounded border border-rose-700/60 p-2">
                <p className="text-xs">La falta volverá a mostrarse como «Falta». La justificación queda en el historial.</p>
                <textarea className={`${inputCls} w-full`} rows={2} maxLength={300} placeholder={`Motivo (mínimo ${MOTIVO_REVERSION_MIN} caracteres)`} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
                <div className="flex gap-2">
                  <button type="button" disabled={enviando || motivo.trim().length < MOTIVO_REVERSION_MIN} onClick={() => void revertir()} className="rounded bg-rose-700 px-3 py-1.5 text-xs text-white disabled:opacity-40">Confirmar reversión</button>
                  <button type="button" disabled={enviando} onClick={() => setRevirtiendo(false)} className="rounded border border-[var(--border)] px-3 py-1.5 text-xs">Cancelar</button>
                </div>
              </div>
            ) : null}

            <div className="space-y-1">
              <p className="text-xs font-medium">Evidencia (opcional)</p>
              {ctx && ctx.evidencias.length ? (
                <ul className="space-y-0.5 text-xs">
                  {ctx.evidencias.map((ev) => (
                    <li key={ev.id} className="flex items-center justify-between gap-2">
                      <a href={`${base}/evidencias/${ev.id}`} target="_blank" rel="noreferrer" className="truncate text-sky-300 hover:underline">{ev.nombre ?? "Evidencia"}</a>
                      <span className="shrink-0 text-[10px] text-[var(--muted)]">{ev.subidoPor ?? "—"} · {ev.subidoEn}</span>
                      {puedeEditar ? <button type="button" disabled={enviando} onClick={() => void quitarEvidencia(ev.id)} className="shrink-0 text-rose-300 disabled:opacity-40">Quitar</button> : null}
                    </li>
                  ))}
                </ul>
              ) : <p className="text-xs text-[var(--muted)]">Sin evidencia.</p>}
              {puedeEditar || puedeCrear ? (
                <label className="block text-xs">
                  Adjuntar (JPG, PNG, WebP o PDF)
                  <input type="file" accept={EXT_ACEPTADAS} disabled={enviando} onChange={(e) => void adjuntar(e)} className="mt-1 block w-full text-xs" />
                </label>
              ) : null}
            </div>
          </section>
        ) : null}

        {!j && ctx && esFalta ? (
          <form onSubmit={justificar} className="space-y-2" aria-label="Nueva justificación">
            {revertida ? (
              <p className="text-xs text-[var(--muted)]">
                Esta falta estuvo justificada y fue revertida por {revertida.revertidoPor} el {revertida.revertidoEn}: {revertida.motivoReversion}
              </p>
            ) : null}
            <label className="flex flex-col gap-0.5 text-xs">
              Tipo / motivo
              <select className={inputCls} value={tipo} disabled={!puedeEscribirNueva || enviando} onChange={(e) => setTipo(e.target.value)} required>
                <option value="">Selecciona…</option>
                {TIPOS_JUSTIFICACION.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-0.5 text-xs">
              Observación (opcional)
              <textarea className={inputCls} rows={2} maxLength={OBSERVACION_JUSTIFICACION_MAX} value={observacion} disabled={!puedeEscribirNueva || enviando} onChange={(e) => setObservacion(e.target.value)} />
            </label>
            {puedeCrear ? (
              <button type="submit" disabled={enviando || !tipo} className="rounded bg-emerald-700 px-3 py-1.5 text-xs text-white disabled:opacity-40">
                {enviando ? "Guardando…" : "Justificar falta"}
              </button>
            ) : (
              <p className="text-xs text-[var(--muted)]">Solo lectura: no tienes permiso para justificar faltas.</p>
            )}
            <p className="text-[10px] text-[var(--muted)]">La falta no se borra ni se convierte en asistencia: queda registrada como «Falta justificada» con tu usuario y la fecha.</p>
          </form>
        ) : null}
      </div>
    </div>
  );
}
