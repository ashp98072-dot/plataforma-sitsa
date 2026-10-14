"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * RRHH → Reportes → Cumpleaños por mes — comprobantes de la tarjeta/vale de cumpleaños de un empleado en UN año. Solo
 * presentación: formatos, tamaño, firma del archivo, tenant y permisos los valida el servidor. Los archivos son privados (se
 * abren por el endpoint protegido; nunca hay una URL pública).
 */

type Comprobante = { id: number; nombre: string | null; subidoEn: string; subidoPor: string | null };

const EXT_ACEPTADAS = ".jpg,.jpeg,.png,.webp,.pdf";
const EXT_REGEX = /\.(jpe?g|png|webp|pdf)$/i;

export function ComprobantesCumpleaniosModal({
  slug, empleadoId, codigo, nombre, fechaUi, anio, puedeAdjuntar, puedeEliminar, onClose, onCambio,
}: {
  slug: string;
  empleadoId: number;
  codigo: string;
  nombre: string;
  /** Fecha de cumpleaños en el año consultado (dd/mm/aaaa). */
  fechaUi: string;
  anio: number;
  puedeAdjuntar: boolean;
  puedeEliminar: boolean;
  onClose: () => void;
  onCambio: () => void;
}) {
  const [lista, setLista] = useState<Comprobante[] | null>(null);
  const [errorLectura, setErrorLectura] = useState("");
  const [error, setError] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [enviando, setEnviando] = useState(false);
  const ocupadoRef = useRef(false);
  const base = `/api/empresas/${slug}/rrhh/cumpleanios/comprobantes`;

  const cargar = useCallback(async () => {
    try {
      const res = await fetch(`${base}?${new URLSearchParams({ empleadoId: String(empleadoId), anio: String(anio) })}`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorLectura(data.error ?? "No se pudieron leer los comprobantes.");
        return;
      }
      setErrorLectura("");
      setLista((data.comprobantes ?? []) as Comprobante[]);
    } catch {
      setErrorLectura("Error de conexión.");
    }
  }, [base, empleadoId, anio]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial del modal
    void cargar();
  }, [cargar]);

  async function adjuntar(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || ocupadoRef.current) return;
    setError("");
    setMensaje("");
    if (!EXT_REGEX.test(file.name)) {
      setError("Formato no permitido. Usa JPG, JPEG, PNG, WebP o PDF.");
      return;
    }
    ocupadoRef.current = true;
    setEnviando(true);
    try {
      const form = new FormData();
      form.set("empleadoId", String(empleadoId));
      form.set("anio", String(anio));
      form.set("file", file);
      const res = await fetch(base, { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "No se pudo adjuntar el comprobante.");
        return;
      }
      setMensaje("Comprobante adjuntado.");
      await cargar();
      onCambio();
    } catch {
      setError("Error de conexión.");
    } finally {
      ocupadoRef.current = false;
      setEnviando(false);
    }
  }

  async function eliminar(id: number) {
    if (ocupadoRef.current) return;
    ocupadoRef.current = true;
    setEnviando(true);
    setError("");
    setMensaje("");
    try {
      const res = await fetch(`${base}/${id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "No se pudo eliminar el comprobante.");
        return;
      }
      setMensaje("Comprobante eliminado.");
      await cargar();
      onCambio();
    } catch {
      setError("Error de conexión.");
    } finally {
      ocupadoRef.current = false;
      setEnviando(false);
    }
  }

  return (
    <div role="dialog" aria-modal="true" aria-label={`Comprobantes de cumpleaños de ${nombre}`} className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="max-h-[90vh] w-full max-w-lg space-y-3 overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 text-sm text-[var(--text)]">
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-base font-semibold">Comprobantes de cumpleaños</h2>
          <button type="button" onClick={onClose} className="rounded border border-[var(--border)] px-2 py-1 text-xs">Cerrar</button>
        </div>
        <ul className="space-y-0.5 text-xs">
          <li><span className="text-[var(--muted)]">Empleado: </span>{nombre}</li>
          <li><span className="text-[var(--muted)]">Código: </span><span className="font-mono">{codigo}</span></li>
          <li><span className="text-[var(--muted)]">Cumpleaños: </span>{fechaUi}</li>
          <li><span className="text-[var(--muted)]">Año: </span><strong>{anio}</strong> <span className="text-[var(--muted)]">(los comprobantes de cada año son independientes)</span></li>
        </ul>

        {errorLectura ? <p role="alert" className="text-xs text-rose-400">{errorLectura}</p> : null}
        {error ? <p role="alert" className="text-xs text-rose-400">{error}</p> : null}
        {mensaje ? <p role="status" className="text-xs text-emerald-300">{mensaje}</p> : null}

        {lista === null && !errorLectura ? <p className="text-xs text-[var(--muted)]">Cargando…</p> : null}
        {lista && !lista.length ? <p className="text-xs text-[var(--muted)]">Sin comprobante para {anio}.</p> : null}
        {lista && lista.length ? (
          <ul className="space-y-1 text-xs" aria-label="Archivos del año">
            {lista.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-[var(--border)] px-2 py-1">
                <a href={`${base}/${c.id}`} target="_blank" rel="noreferrer" className="min-w-0 truncate text-sky-300 hover:underline">
                  {c.nombre ?? "Comprobante"}
                </a>
                <span className="shrink-0 text-[10px] text-[var(--muted)]">{c.subidoPor ?? "—"} · {c.subidoEn}</span>
                {puedeEliminar ? (
                  <button type="button" disabled={enviando} onClick={() => void eliminar(c.id)} className="shrink-0 text-rose-300 disabled:opacity-40">Eliminar</button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}

        {puedeAdjuntar ? (
          <label className="block text-xs">
            Adjuntar comprobante (JPG, JPEG, PNG, WebP o PDF)
            <input type="file" accept={EXT_ACEPTADAS} disabled={enviando} onChange={(e) => void adjuntar(e)} className="mt-1 block w-full text-xs" />
          </label>
        ) : (
          <p className="text-xs text-[var(--muted)]">Solo lectura: no tienes permiso para adjuntar comprobantes.</p>
        )}
      </div>
    </div>
  );
}
