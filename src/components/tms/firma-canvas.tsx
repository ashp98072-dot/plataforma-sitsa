"use client";

import { useImperativeHandle, useLayoutEffect, useRef, type PointerEvent as ReactPointerEvent, type Ref } from "react";

/** Dimensión final del PNG exportado — nunca se envía una captura de tamaño arbitrario. */
const ANCHO_MAX = 800;
const ALTO_MAX = 300;

export type FirmaCanvasHandle = {
  /** PNG del trazo actual, o `null` si no hay trazo. El padre lo llama SOLO al confirmar (no en cada trazo). */
  obtenerImagen: () => Promise<File | null>;
};

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
 * interna ya existente (usuario autenticado + permiso + hash + timestamp
 * servidor + auditoría, ver src/lib/firmas/firmas-internas.ts) — NUNCA la
 * sustituye ni es el único mecanismo de autenticación.
 *
 * CORRECCIÓN URGENTE (2ª vuelta) — "la firma desaparece al soltar el
 * mouse", persistía tras el primer intento de arreglo (snapshot +
 * restauración en useLayoutEffect, que se mantiene aquí como defensa
 * adicional). La causa raíz real: antes se llamaba `onFirmaCambia` (con
 * el File completo) al terminar CADA trazo, lo que hacía re-renderizar al
 * padre mientras el usuario seguía usando el modal — y un re-render del
 * padre puede comprometer el bitmap del canvas hijo por razones que no
 * dependen de este componente. Ahora el componente NO empuja el File al
 * padre en absoluto durante el dibujo: expone `obtenerImagen()` vía `ref`
 * (React 19 — ref como prop normal, sin `forwardRef`) y el padre lo
 * invoca UNA sola vez, al confirmar. Durante el dibujo solo se notifica
 * `onCambiaTrazo(true)` (booleano, para habilitar el botón) la PRIMERA
 * vez que aparece un trazo en el gesto — nunca en cada punto/segmento —
 * así el padre re-renderiza como máximo una vez por gesto, nunca en medio
 * de un trazo activo. Además elimina los `toBlob` repetidos (antes uno
 * por trazo completado; ahora uno solo, al confirmar).
 */
export default function FirmaCanvas({
  ref,
  onCambiaTrazo,
  disabled,
}: {
  ref?: Ref<FirmaCanvasHandle>;
  onCambiaTrazo?: (tieneTrazo: boolean) => void;
  disabled?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dibujando = useRef(false);
  const ultimoPunto = useRef<{ x: number; y: number } | null>(null);
  const huboTrazoRef = useRef(false);
  // Snapshot del bitmap tras cada trazo/punto — defensa adicional: si
  // pese a la arquitectura sin-re-render-a-mitad-de-trazo el bitmap
  // igual se perdiera por algún otro motivo, este useLayoutEffect lo
  // repone ANTES de que el navegador pinte.
  const snapshotRef = useRef<ImageData | null>(null);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx && snapshotRef.current) {
      ctx.putImageData(snapshotRef.current, 0, 0);
    }
  });

  function posicion(e: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  /** Un toque/clic corto sin arrastre también cuenta como firma real (un punto). */
  function dibujarPunto(p: { x: number; y: number }) {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#1f2937";
    ctx.beginPath();
    ctx.arc(p.x, p.y, 1.5, 0, Math.PI * 2);
    ctx.fill();
  }

  function tomarSnapshot() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) snapshotRef.current = ctx.getImageData(0, 0, canvas.width, canvas.height);
  }

  function handlePointerDown(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (disabled) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // best-effort: si el navegador no soporta o rechaza la captura,
      // igual seguimos dibujando con los eventos normales.
    }
    dibujando.current = true;
    const p = posicion(e);
    ultimoPunto.current = p;
    dibujarPunto(p);
    const eraNuevoTrazo = !huboTrazoRef.current;
    huboTrazoRef.current = true;
    tomarSnapshot();
    // Solo la PRIMERA vez que aparece trazo en este gesto se notifica al
    // padre (habilita el botón) — nunca en cada punto/segmento.
    if (eraNuevoTrazo) onCambiaTrazo?.(true);
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
    tomarSnapshot();
  }

  function terminarTrazo(e: ReactPointerEvent<HTMLCanvasElement>) {
    dibujando.current = false;
    ultimoPunto.current = null;
    try {
      canvasRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      // best-effort — el navegador ya libera la captura automáticamente en pointerup/cancel.
    }
  }

  function limpiar() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    huboTrazoRef.current = false;
    snapshotRef.current = null;
    onCambiaTrazo?.(false);
  }

  useImperativeHandle(ref, () => ({
    obtenerImagen: () =>
      new Promise<File | null>((resolve) => {
        const canvas = canvasRef.current;
        if (!canvas || !huboTrazoRef.current) {
          resolve(null);
          return;
        }
        canvas.toBlob((blob) => {
          resolve(blob ? new File([blob], "firma.png", { type: "image/png" }) : null);
        }, "image/png");
      }),
  }));

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
