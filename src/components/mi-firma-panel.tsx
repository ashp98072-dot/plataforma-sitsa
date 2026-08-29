"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import FirmaCanvas, { type FirmaCanvasHandle } from "@/components/tms/firma-canvas";
import { TEXTO_FIRMA_INTERNA } from "@/lib/firmas/textos";

type EstadoFirma = { tieneFirma: boolean; actualizadoEn: string | null };

/**
 * MI-FIRMA-1 — "Mi firma": plantilla personal reutilizable, GLOBAL por
 * usuario (no depende de la empresa activa, aunque el endpoint vive bajo
 * /e/[slug]/... por conveniencia de sesión — ver
 * src/lib/firmas/usuario-firmas.ts). Registrar/reemplazar/eliminar
 * SOLO afecta esta plantilla — nunca toca firmas_electronicas: cada
 * autorización/liquidación que use "mi firma guardada" genera su propia
 * copia física independiente en el servidor.
 */
export default function MiFirmaPanel({ slug }: { slug: string }) {
  const canvasRef = useRef<FirmaCanvasHandle | null>(null);
  const [estado, setEstado] = useState<EstadoFirma | null>(null);
  const [tieneTrazo, setTieneTrazo] = useState(false);
  const [reemplazando, setReemplazando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [eliminando, setEliminando] = useState(false);
  const [error, setError] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [sesion, setSesion] = useState(0);

  const cargar = useCallback(async () => {
    try {
      const res = await fetch(`/api/empresas/${slug}/mi-firma`);
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setEstado({ tieneFirma: Boolean(data.tieneFirma), actualizadoEn: data.actualizadoEn ?? null });
      } else {
        setError(data.error ?? `No se pudo consultar tu firma (${res.status}).`);
      }
    } catch {
      setError("Error de conexión.");
    }
  }, [slug]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void cargar();
  }, [cargar]);

  async function guardar() {
    const firmaImagen = await canvasRef.current?.obtenerImagen();
    if (!firmaImagen) {
      setError("Dibuja tu firma antes de continuar.");
      return;
    }
    setGuardando(true);
    setError("");
    setMensaje("");
    try {
      const fd = new FormData();
      fd.set("firmaImagen", firmaImagen, "firma.png");
      const res = await fetch(`/api/empresas/${slug}/mi-firma`, { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? `No se pudo guardar tu firma (${res.status}).`);
        return;
      }
      setMensaje("Firma guardada.");
      setReemplazando(false);
      setSesion((n) => n + 1);
      await cargar();
    } catch {
      setError("Error de conexión.");
    } finally {
      setGuardando(false);
    }
  }

  async function eliminar() {
    setEliminando(true);
    setError("");
    setMensaje("");
    try {
      const res = await fetch(`/api/empresas/${slug}/mi-firma`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? `No se pudo eliminar tu firma (${res.status}).`);
        return;
      }
      setMensaje("Firma eliminada.");
      await cargar();
    } catch {
      setError("Error de conexión.");
    } finally {
      setEliminando(false);
    }
  }

  if (!estado) {
    return <p className="text-sm text-[var(--muted)]">Cargando…</p>;
  }

  const mostrarCanvas = !estado.tieneFirma || reemplazando;

  return (
    <div className="max-w-md space-y-4 rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
      {error ? <p className="text-xs text-red-300">{error}</p> : null}
      {mensaje ? <p className="text-xs text-emerald-300">{mensaje}</p> : null}

      {!mostrarCanvas ? (
        <>
          <p className="text-sm font-medium">Firma guardada:</p>
          {/* eslint-disable-next-line @next/next/no-img-element -- imagen servida por endpoint autenticado propio, no un asset estático de Next. */}
          <img
            src={`/api/empresas/${slug}/mi-firma/imagen`}
            alt="Mi firma"
            className="h-32 w-full rounded border border-[var(--border)] bg-white object-contain"
          />
          <p className="text-xs text-[var(--muted)]">
            Última actualización:{" "}
            {estado.actualizadoEn ? new Date(estado.actualizadoEn).toLocaleString("es-GT") : "—"}
          </p>
          <p className="text-[10px] text-[var(--muted)]">
            {TEXTO_FIRMA_INTERNA} — se usa como plantilla visual al autorizar/liquidar; cada uso genera su propia
            copia independiente, cambiarla o eliminarla nunca modifica autorizaciones ya firmadas.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setReemplazando(true);
                setError("");
                setMensaje("");
              }}
              className="rounded bg-[var(--accent)] px-3 py-1.5 text-sm text-white"
            >
              Cambiar firma
            </button>
            <button
              type="button"
              disabled={eliminando}
              onClick={() => void eliminar()}
              className="rounded border border-[var(--border)] px-3 py-1.5 text-sm disabled:opacity-50"
            >
              {eliminando ? "Eliminando…" : "Eliminar firma"}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm text-[var(--muted)]">
            {estado.tieneFirma ? "Dibuja tu nueva firma:" : "Aún no tienes una firma guardada. Dibuja tu firma:"}
          </p>
          <FirmaCanvas ref={canvasRef} sesionId={`mi-firma-${sesion}`} onCambiaTrazo={setTieneTrazo} disabled={guardando} />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={guardando || !tieneTrazo}
              onClick={() => void guardar()}
              className="rounded bg-[var(--accent)] px-3 py-1.5 text-sm text-white disabled:opacity-50"
            >
              {guardando ? "Guardando…" : "Guardar firma"}
            </button>
            {estado.tieneFirma ? (
              <button
                type="button"
                disabled={guardando}
                onClick={() => {
                  setReemplazando(false);
                  setError("");
                }}
                className="rounded border border-[var(--border)] px-3 py-1.5 text-sm disabled:opacity-50"
              >
                Cancelar
              </button>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
