"use client";

import { useImperativeHandle, useLayoutEffect, useRef, type PointerEvent as ReactPointerEvent, type Ref } from "react";

/** Dimensión final del PNG exportado — nunca se envía una captura de tamaño arbitrario. */
const ANCHO_MAX = 800;
const ALTO_MAX = 300;

export type FirmaCanvasHandle = {
  /** PNG del trazo actual, o `null` si no hay trazo. El padre lo llama SOLO al confirmar (no en cada trazo). */
  obtenerImagen: () => Promise<File | null>;
};

type Punto = { x: number; y: number };

/**
 * VIATICOS-FIRMA-VISUAL — canvas nativo reutilizable para capturar una
 * firma manuscrita con mouse/touch/stylus (Pointer Events unificados:
 * pointerdown/pointermove/pointerup/pointercancel — sin librería externa).
 * Genera un PNG transparente (nunca se rellena el fondo del canvas, solo
 * se dibuja el trazo) normalizado al buffer interno fijo 800x300.
 *
 * Esta imagen es un adjunto visual ADICIONAL a la firma electrónica
 * interna ya existente — NUNCA la sustituye ni es el único mecanismo de
 * autenticación.
 *
 * CORRECCIÓN URGENTE (3ª vuelta) — "la firma desaparece al soltar el
 * mouse" seguía ocurriendo pese a (1) snapshot+restauración y (2) evitar
 * empujar el File al padre en cada trazo. Ninguna de esas dos defensas
 * asumía CUÁNDO exactamente se pierde el bitmap del canvas — solo
 * intentaban reponerlo después. Este rediseño elimina la dependencia del
 * bitmap del canvas como fuente de verdad: los trazos se guardan como
 * DATOS (arrays de puntos) en un ref, nunca en el propio `<canvas>`. El
 * canvas se REPINTA POR COMPLETO desde esos datos:
 *   1) de forma inmediata en cada pointermove (para feedback fluido), y
 *   2) en un `useLayoutEffect` sin dependencias que corre después de
 *      CADA render de este componente — así, sin importar qué re-render
 *      del padre ocurra ni qué le pase al bitmap por el camino, el
 *      siguiente commit siempre vuelve a dibujar el trazo completo desde
 *      los datos guardados, ANTES de que el navegador pinte. El bitmap
 *      del `<canvas>` deja de ser algo que haya que "preservar": es
 *      simplemente una proyección desechable de los datos, recalculada
 *      en cada oportunidad.
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
  // Fuente de verdad: cada trazo es un array de puntos. Un toque/clic sin
  // arrastre queda como un trazo de UN solo punto (se dibuja como punto).
  const trazosRef = useRef<Punto[][]>([]);
  const trazoActualRef = useRef<Punto[]>([]);

  function redibujarTodo() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#1f2937";
    ctx.strokeStyle = "#1f2937";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const todos = trazoActualRef.current.length ? [...trazosRef.current, trazoActualRef.current] : trazosRef.current;
    for (const trazo of todos) {
      if (trazo.length === 0) continue;
      if (trazo.length === 1) {
        ctx.beginPath();
        ctx.arc(trazo[0].x, trazo[0].y, 1.5, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      ctx.beginPath();
      ctx.moveTo(trazo[0].x, trazo[0].y);
      for (let i = 1; i < trazo.length; i++) ctx.lineTo(trazo[i].x, trazo[i].y);
      ctx.stroke();
    }
  }

  // Repinta desde los datos DESPUÉS de cada render (mount o update),
  // antes de que el navegador pinte — nunca depende de que el bitmap
  // anterior siga intacto.
  useLayoutEffect(() => {
    redibujarTodo();
  });

  function posicion(e: ReactPointerEvent<HTMLCanvasElement>): Punto {
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
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // best-effort: si el navegador no soporta o rechaza la captura,
      // igual seguimos dibujando con los eventos normales.
    }
    dibujando.current = true;
    trazoActualRef.current = [posicion(e)];
    const eraPrimerTrazo = trazosRef.current.length === 0;
    redibujarTodo();
    // Solo la PRIMERA vez que aparece trazo se notifica al padre (habilita
    // el botón) — nunca en cada punto/segmento, para minimizar re-renders.
    if (eraPrimerTrazo) onCambiaTrazo?.(true);
  }

  function handlePointerMove(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (!dibujando.current || disabled) return;
    trazoActualRef.current.push(posicion(e));
    redibujarTodo();
  }

  function terminarTrazo(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (dibujando.current && trazoActualRef.current.length > 0) {
      trazosRef.current = [...trazosRef.current, trazoActualRef.current];
    }
    trazoActualRef.current = [];
    dibujando.current = false;
    redibujarTodo();
    try {
      canvasRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      // best-effort — el navegador ya libera la captura automáticamente en pointerup/cancel.
    }
  }

  function limpiar() {
    trazosRef.current = [];
    trazoActualRef.current = [];
    redibujarTodo();
    onCambiaTrazo?.(false);
  }

  useImperativeHandle(ref, () => ({
    obtenerImagen: () =>
      new Promise<File | null>((resolve) => {
        const canvas = canvasRef.current;
        if (!canvas || trazosRef.current.length === 0) {
          resolve(null);
          return;
        }
        redibujarTodo();
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
