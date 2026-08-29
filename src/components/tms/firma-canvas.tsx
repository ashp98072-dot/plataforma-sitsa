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
 * VIATICOS-FIRMA-VISUAL (CORRECCIÓN URGENTE, 4ª vuelta) — respaldo en
 * memoria de proceso (NUNCA localStorage/sessionStorage — ver decisión
 * explícita del ticket original de no persistir firmas en almacenamiento
 * del navegador) de los trazos de la sesión de firma ACTUALMENTE activa.
 * Vive fuera del ciclo de vida del componente para sobrevivir aunque
 * FirmaCanvas se desmonte y remonte por completo mientras el usuario
 * sigue dibujando (causa que no se pudo confirmar con certeza pese a 3
 * rondas de corrección — ver JSDoc del componente) — un simple `let` de
 * módulo no depende de refs ni de que la instancia de React sobreviva.
 * `sesionId` evita reusar el trazo de un viático/modal distinto: si el
 * padre abre una NUEVA sesión de firma (nuevo `sesionId`), el respaldo de
 * la sesión anterior se descarta, nunca se reutiliza entre autorizaciones.
 */
let respaldoSesion: { sesionId: string; trazos: Punto[][] } | null = null;

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
 * CORRECCIÓN URGENTE (rondas 2-3) — "la firma desaparece al soltar el
 * mouse" seguía ocurriendo pese a (1) snapshot+restauración del bitmap y
 * (2) evitar empujar el File al padre en cada trazo (solo un booleano).
 * Ninguna reprodujo el fallo en local (dev, Chrome vía CDP, con
 * PointerEvents reales e inspección directa de píxeles) pero SÍ persistía
 * reportado en producción (Hostinger, tras redeploy + hard refresh
 * confirmados, sin errores de consola) — descartando caché de navegador.
 * Este archivo ya NO depende del bitmap del `<canvas>` como fuente de
 * verdad: los trazos se guardan como DATOS (arrays de puntos) en un ref,
 * y el canvas se REPINTA POR COMPLETO desde esos datos en cada
 * pointermove y en un `useLayoutEffect` sin dependencias que corre
 * después de CADA render. Ronda 4 (esta): además se respalda esa misma
 * lista de puntos en `respaldoSesion` (memoria de módulo, ver arriba) por
 * si la causa real es que el propio componente se desmonta/remonta por
 * completo (no solo que su bitmap se pierda) — algo que no se pudo
 * confirmar ni descartar con certeza sin acceso al entorno real. Si el
 * componente remonta, el primer render recupera `trazosRef` desde este
 * respaldo (mismo `sesionId`) antes de que el `useLayoutEffect` repinte.
 */
export default function FirmaCanvas({
  ref,
  sesionId,
  onCambiaTrazo,
  disabled,
}: {
  ref?: Ref<FirmaCanvasHandle>;
  /**
   * Identificador de ESTA sesión de firma (p. ej. `autorizar-123`,
   * `liquidar-45`, `masivo-<timestamp>`) — el padre debe pasar un valor
   * NUEVO cada vez que abre el modal, para que el respaldo nunca se
   * reutilice entre autorizaciones distintas ni entre reaperturas del
   * mismo modal. Sin `sesionId`, no hay respaldo entre remontajes (se
   * comporta como antes).
   */
  sesionId?: string;
  onCambiaTrazo?: (tieneTrazo: boolean) => void;
  disabled?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dibujando = useRef(false);
  // Fuente de verdad: cada trazo es un array de puntos. Un toque/clic sin
  // arrastre queda como un trazo de UN solo punto (se dibuja como punto).
  // Se inicializa desde respaldoSesion si esta instancia arranca con el
  // MISMO sesionId que el respaldo vigente (sobrevive a un remount).
  const trazosRef = useRef<Punto[][]>(
    sesionId && respaldoSesion?.sesionId === sesionId ? respaldoSesion.trazos : [],
  );
  const trazoActualRef = useRef<Punto[]>([]);

  function persistirRespaldo() {
    if (!sesionId) return;
    respaldoSesion = { sesionId, trazos: trazosRef.current };
  }

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
  // anterior siga intacto, ni de que la instancia previa del componente
  // siga montada (trazosRef ya arrancó restaurado desde respaldoSesion
  // si correspondía).
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
    persistirRespaldo();
    // Solo la PRIMERA vez que aparece trazo se notifica al padre (habilita
    // el botón) — nunca en cada punto/segmento, para minimizar re-renders.
    if (eraPrimerTrazo) onCambiaTrazo?.(true);
  }

  function handlePointerMove(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (!dibujando.current || disabled) return;
    trazoActualRef.current.push(posicion(e));
    redibujarTodo();
    // Respaldo continuo durante el arrastre: si el remount ocurre A MITAD
    // de un trazo (no solo entre trazos), igual hay algo que recuperar.
    if (sesionId) respaldoSesion = { sesionId, trazos: [...trazosRef.current, trazoActualRef.current] };
  }

  function terminarTrazo(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (dibujando.current && trazoActualRef.current.length > 0) {
      trazosRef.current = [...trazosRef.current, trazoActualRef.current];
    }
    trazoActualRef.current = [];
    dibujando.current = false;
    redibujarTodo();
    persistirRespaldo();
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
    persistirRespaldo();
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
