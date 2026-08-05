"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  label: string;
  disabled?: boolean;
  className?: string;
  /** Texto corto bajo el botón (ej. nombre del archivo capturado). */
  hint?: string;
  onCaptured: (file: File) => void | Promise<void>;
};

/**
 * Solo cámara en vivo (sin galería / archivos adjuntos).
 * Si el navegador no da getUserMedia, usa input capture como respaldo.
 */
export function TomarFotoButton({
  label,
  disabled,
  className,
  hint,
  onCaptured,
}: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState("");

  function stopStream() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setReady(false);
  }

  useEffect(() => {
    if (!open) {
      stopStream();
      return;
    }
    let cancelled = false;
    setErr("");
    setReady(false);
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setErr("Tu navegador no permite cámara en vivo. Usa «Cámara del sistema».");
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1600 },
            height: { ideal: 1200 },
          },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play().catch(() => undefined);
        }
        setReady(true);
      } catch {
        setErr(
          "No se pudo abrir la cámara. Revisa permisos o usa «Cámara del sistema».",
        );
      }
    })();
    return () => {
      cancelled = true;
      stopStream();
    };
  }, [open]);

  async function capturar() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) {
      setErr("Espera a que la cámara cargue y vuelve a intentar.");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      const maxW = 1600;
      const scale = Math.min(1, maxW / video.videoWidth);
      const w = Math.max(1, Math.round(video.videoWidth * scale));
      const h = Math.max(1, Math.round(video.videoHeight * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("No se pudo capturar la imagen.");
      ctx.drawImage(video, 0, 0, w, h);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), "image/jpeg", 0.9),
      );
      if (!blob || blob.size < 100) {
        throw new Error("La foto quedó vacía. Intenta de nuevo.");
      }
      const file = new File([blob], `camara_${Date.now()}.jpg`, {
        type: "image/jpeg",
      });
      await onCaptured(file);
      setOpen(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "No se pudo capturar");
    } finally {
      setBusy(false);
    }
  }

  async function onFallbackChange(files: FileList | null) {
    const raw = files?.[0];
    if (!raw) return;
    setBusy(true);
    setErr("");
    try {
      let file = raw;
      if (!file.size) {
        const buf = await file.arrayBuffer();
        if (!buf.byteLength) {
          throw new Error("La foto está vacía. Toma otra con la cámara.");
        }
        file = new File([buf], file.name || `camara_${Date.now()}.jpg`, {
          type: file.type || "image/jpeg",
        });
      }
      await onCaptured(file);
      setOpen(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "No se pudo usar la foto");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="inline-flex flex-col gap-0.5">
      <button
        type="button"
        disabled={disabled || busy}
        className={
          className ||
          "rounded bg-[#334155] px-2 py-1 text-[11px] text-white disabled:opacity-40"
        }
        onClick={() => setOpen(true)}
      >
        {busy ? "Procesando…" : label}
      </button>
      {hint ? (
        <span className="text-[10px] text-[var(--muted)]">{hint}</span>
      ) : null}

      {open ? (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/75 p-3 sm:items-center">
          <div className="w-full max-w-md overflow-hidden rounded-xl border border-[var(--border)] bg-[#0f1720] shadow-xl">
            <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-2">
              <p className="text-sm font-medium text-[var(--fg)]">
                Tomar fotografía
              </p>
              <button
                type="button"
                className="text-xs text-[var(--muted)]"
                onClick={() => setOpen(false)}
              >
                Cerrar
              </button>
            </div>
            <div className="space-y-3 p-3">
              <div className="relative aspect-[4/3] overflow-hidden rounded-lg bg-black">
                <video
                  ref={videoRef}
                  playsInline
                  muted
                  autoPlay
                  className="h-full w-full object-cover"
                />
              </div>
              {err ? (
                <p className="text-xs text-rose-300">{err}</p>
              ) : (
                <p className="text-[11px] text-[var(--muted)]">
                  Solo cámara en vivo. No se puede adjuntar desde la galería.
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy || !ready}
                  onClick={() => void capturar()}
                  className="flex-1 rounded bg-[var(--accent-2)] px-3 py-2 text-sm font-medium text-white disabled:opacity-40"
                >
                  {busy ? "Guardando…" : "Capturar foto"}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  className="rounded border border-[var(--border)] px-3 py-2 text-xs text-[var(--muted)]"
                  onClick={() => fileRef.current?.click()}
                >
                  Cámara del sistema
                </button>
              </div>
              {/* capture fuerza cámara; sin multiple para evitar File.size=0 en Android */}
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => void onFallbackChange(e.target.files)}
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
