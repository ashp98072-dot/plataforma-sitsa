"use client";

import { useRef, type PointerEvent as ReactPointerEvent } from "react";

/** Dimensión final del PNG exportado — nunca se envía una captura de tamaño arbitrario. */
const ANCHO_MAX = 800;
const ALTO_MAX = 300;

/**
 * VIATICOS-FIRMA-VISUAL — canvas nativo reutilizable para capturar una
 * firma manuscrita con mouse/touch/stylus (Pointer Events unificados:
 * pointerdown/pointermove/pointerup/pointercancel — sin librería externa).
 * Genera un PNG transparente (nunca se rellena el fondo del canvas, solo
 * se dibuja el trazo) normalizado al buffer interno fijo 800x300 — el
 * tamaño VISUAL en pantalla lo escala el CSS, el buffer que se exporta
 * nunca cambia de tamaño.
 *
 * Esta imagen es un adjunto visual ADICIONAL a la firma electrónica
 * interna ya existente (contraseña + hash + timestamp servidor +
 * auditoría, ver src/lib/firmas/firmas-internas.ts) — NUNCA la sustituye
 * ni es el único mecanismo de autenticación.
 *
 * Uso: el padre pasa `onFirmaCambia` y recibe el último File PNG (o
 * `null` si no hay trazo — tras "Limpiar firma" o antes de dibujar nada);
 * el padre debe bloquear el envío mientras el valor sea `null`.
 */
export default function FirmaCanvas({
  onFirmaCambia,
  disabled,
}: {
  onFirmaCambia: (archivo: File | null) => void;
  disabled?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dibujando = useRef(false);
  const ultimoPunto = useRef<{ x: number; y: number } | null>(null);
  // Ref (no state): esta pieza no necesita re-renderizar por sí misma — el
  // padre ya recibe el resultado vía onFirmaCambia en cada trazo/limpieza.
  const huboTrazoRef = useRef(false);

  function posicion(e: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  function handlePointerDown(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (disabled) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);
    dibujando.current = true;
    ultimoPunto.current = posicion(e);
  }

  function handlePointerMove(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (!dibujando.current || disabled) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !ultimoPunto.current) return;
    const punto = posicion(e);
    ctx.strokeStyle = "#1f2937";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(ultimoPunto.current.x, ultimoPunto.current.y);
    ctx.lineTo(punto.x, punto.y);
    ctx.stroke();
    ultimoPunto.current = punto;
    huboTrazoRef.current = true;
  }

  function regenerarImagen() {
    const canvas = canvasRef.current;
    if (!canvas || !huboTrazoRef.current) {
      onFirmaCambia(null);
      return;
    }
    canvas.toBlob((blob) => {
      onFirmaCambia(blob ? new File([blob], "firma.png", { type: "image/png" }) : null);
    }, "image/png");
  }

  function terminarTrazo() {
    if (dibujando.current) regenerarImagen();
    dibujando.current = false;
    ultimoPunto.current = null;
  }

  function limpiar() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    huboTrazoRef.current = false;
    onFirmaCambia(null);
  }

  return (
    <div className="space-y-1">
      <canvas
        ref={canvasRef}
        width={ANCHO_MAX}
        height={ALTO_MAX}
        className="w-full touch-none rounded border border-[var(--border)] bg-white"
        style={{ aspectRatio: `${ANCHO_MAX} / ${ALTO_MAX}` }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={terminarTrazo}
        onPointerCancel={terminarTrazo}
        onPointerLeave={terminarTrazo}
      />
      <button
        type="button"
        disabled={disabled}
        onClick={limpiar}
        className="rounded border border-[var(--border)] px-2 py-1 text-xs disabled:opacity-50"
      >
        Limpiar firma
      </button>
    </div>
  );
}
