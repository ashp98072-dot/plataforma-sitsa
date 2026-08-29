"use client";

import { useLayoutEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";

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
 * interna ya existente (usuario autenticado + permiso + hash + timestamp
 * servidor + auditoría, ver src/lib/firmas/firmas-internas.ts) — NUNCA la
 * sustituye ni es el único mecanismo de autenticación.
 *
 * Hotfix (corrección urgente) — "la firma desaparece al soltar el mouse":
 * cada trazo dispara `onFirmaCambia` hacia el padre, que guarda el File
 * en estado y por tanto RE-RENDERIZA. Un re-render del padre puede volver
 * a comprometer el bitmap del canvas (p. ej. si en algún punto se
 * reescribe `width`/`height`, algo que SIEMPRE limpia el canvas incluso
 * con el mismo valor). Para blindarnos ante eso — sin depender de
 * adivinar la causa exacta — se guarda un snapshot (`ImageData`) tras
 * cada trazo y se restaura en un `useLayoutEffect` que corre después de
 * CADA render, ANTES de que el navegador pinte: si el bitmap se perdió,
 * se repone antes de que el usuario llegue a verlo en blanco.
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
  // Snapshot del bitmap tras el último trazo completado — ver hotfix arriba.
  const snapshotRef = useRef<ImageData | null>(null);

  // Restaura el snapshot DESPUÉS de cada render (mount o update), antes
  // del pintado del navegador — si el bitmap del canvas se perdió por un
  // re-render del padre, se repone aquí sin que el usuario llegue a verlo
  // en blanco. No-op si aún no hay snapshot (nada dibujado) o si se acaba
  // de limpiar (snapshotRef.current === null tras "Limpiar firma").
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
    // Punto inicial visible de inmediato (cubre el caso de un toque corto
    // sin movimiento — nunca debe quedar como "sin trazo").
    dibujarPunto(p);
    huboTrazoRef.current = true;
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
  }

  function regenerarImagen() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !huboTrazoRef.current) {
      onFirmaCambia(null);
      return;
    }
    // Snapshot ANTES de notificar al padre — el próximo re-render que esa
    // notificación dispare ya tiene de dónde restaurar (ver useLayoutEffect).
    snapshotRef.current = ctx.getImageData(0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      onFirmaCambia(blob ? new File([blob], "firma.png", { type: "image/png" }) : null);
    }, "image/png");
  }

  function terminarTrazo(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (dibujando.current) regenerarImagen();
    dibujando.current = false;
    ultimoPunto.current = null;
    const canvas = canvasRef.current;
    try {
      canvas?.releasePointerCapture(e.pointerId);
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
