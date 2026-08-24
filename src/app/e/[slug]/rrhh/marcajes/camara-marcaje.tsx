"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

export function CamaraMarcaje({
  disabled,
  onCapture,
}: {
  disabled: boolean;
  onCapture: (foto: Blob | null) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const previewRef = useRef<string | null>(null);
  const [activa, setActiva] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
  }, []);

  function detener() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setActiva(false);
  }

  async function abrir() {
    setError("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Este dispositivo no permite abrir la cámara directamente.");
      return;
    }
    try {
      detener();
      onCapture(null);
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
      previewRef.current = null;
      setPreview(null);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "user" } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setActiva(true);
    } catch {
      setError("Autoriza el permiso de cámara para tomar la fotografía.");
    }
  }

  async function capturar() {
    const video = videoRef.current;
    if (!video || video.videoWidth < 1 || video.videoHeight < 1) {
      setError("La cámara todavía no está lista.");
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.9),
    );
    if (!blob) {
      setError("No se pudo capturar la fotografía.");
      return;
    }
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    const url = URL.createObjectURL(blob);
    previewRef.current = url;
    setPreview(url);
    onCapture(blob);
    detener();
  }

  return (
    <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3">
      <p className="text-xs font-medium">Fotografía de identidad</p>
      <p className="mt-1 text-[11px] text-[var(--muted)]">
        Debe tomarse en este momento. No se permite seleccionar una imagen de la galería.
      </p>
      <video
        ref={videoRef}
        className={`mt-3 w-full rounded-lg bg-black ${activa ? "block" : "hidden"}`}
        playsInline
        muted
      />
      {preview ? (
        <Image
          src={preview}
          alt="Fotografía tomada para el marcaje"
          width={720}
          height={720}
          unoptimized
          className="mt-3 h-auto w-full rounded-lg"
        />
      ) : null}
      <div className="mt-3 flex gap-2">
        {!activa ? (
          <button type="button" disabled={disabled} onClick={() => void abrir()} className="flex-1 rounded bg-[#334155] px-3 py-2 text-sm text-white disabled:opacity-50">
            {preview ? "Tomar otra foto" : "Abrir cámara"}
          </button>
        ) : (
          <>
            <button type="button" disabled={disabled} onClick={() => void capturar()} className="flex-1 rounded bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
              Tomar foto
            </button>
            <button type="button" onClick={detener} className="rounded border border-[var(--border)] px-3 py-2 text-sm">
              Cancelar
            </button>
          </>
        )}
      </div>
      {error ? <p className="mt-2 text-xs text-rose-300">{error}</p> : null}
    </div>
  );
}
