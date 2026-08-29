"use client";

import { useEffect, useImperativeHandle, useLayoutEffect, useRef, type Ref } from "react";

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
 * sigue dibujando — un simple `let` de módulo no depende de refs ni de
 * que la instancia de React sobreviva. `sesionId` evita reusar el trazo
 * de un viático/modal distinto: si el padre abre una NUEVA sesión de
 * firma (nuevo `sesionId`), el respaldo de la sesión anterior se
 * descarta, nunca se reutiliza entre autorizaciones.
 */
let respaldoSesion: { sesionId: string; trazos: Punto[][] } | null = null;

/**
 * VIATICOS-FIRMA-VISUAL — canvas nativo reutilizable para capturar una
 * firma manuscrita con mouse/touch/stylus. Genera un PNG transparente
 * (nunca se rellena el fondo del canvas, solo se dibuja el trazo)
 * normalizado al buffer interno fijo 800x300.
 *
 * Esta imagen es un adjunto visual ADICIONAL a la firma electrónica
 * interna ya existente — NUNCA la sustituye ni es el único mecanismo de
 * autenticación.
 *
 * CORRECCIÓN URGENTE (rondas 2-4) — "la firma desaparece al soltar el
 * mouse" seguía ocurriendo pese a: (1) snapshot+restauración del bitmap,
 * (2) evitar empujar el File al padre en cada trazo (solo un booleano),
 * (3) repintado completo desde datos en cada render, (4) respaldo en
 * memoria de módulo por si el componente remonta. Ninguna reprodujo el
 * fallo en local (dev, Chrome vía CDP, con PointerEvents reales e
 * inspección directa de píxeles) pero el usuario lo reportó igual en
 * producción (Hostinger, redeploy + hard refresh confirmados, sin
 * errores de consola, mouse físico + Chrome — el mismo escenario ya
 * probado).
 *
 * Ronda 5 (esta): los manejadores de puntero YA NO se registran como
 * props JSX de React (`onPointerDown={...}`, que pasan por el sistema de
 * eventos sintéticos/delegados de React, con un pipeline de despacho que
 * SÍ puede diferir entre el build de desarrollo y el de producción). Se
 * registran con `addEventListener` NATIVO directamente sobre el nodo
 * `<canvas>` en un `useEffect`, fuera del sistema de eventos de React
 * por completo — el dibujo (lectura de coordenadas + `ctx.stroke`/
 * `ctx.arc`) ya no depende de NINGÚN mecanismo de React en absoluto,
 * solo del DOM. `disabled` se lee de un ref sincronizado aparte para que
 * los listeners se registren UNA sola vez por montaje (nunca se
 * reasignan mientras el componente vive).
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
   * mismo modal. Sin `sesionId`, no hay respaldo entre remontajes.
   */
  sesionId?: string;
  onCambiaTrazo?: (tieneTrazo: boolean) => void;
  disabled?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dibujando = useRef(false);
  const disabledRef = useRef(disabled);
  // Fuente de verdad: cada trazo es un array de puntos. Un toque/clic sin
  // arrastre queda como un trazo de UN solo punto (se dibuja como punto).
  // Se inicializa desde respaldoSesion si esta instancia arranca con el
  // MISMO sesionId que el respaldo vigente (sobrevive a un remount).
  const trazosRef = useRef<Punto[][]>(
    sesionId && respaldoSesion?.sesionId === sesionId ? respaldoSesion.trazos : [],
  );
  const trazoActualRef = useRef<Punto[]>([]);
  const onCambiaTrazoRef = useRef(onCambiaTrazo);

  // Los refs "espejo" de props NUNCA se escriben durante el render (regla
  // de hooks) — se sincronizan aquí, después de cada render.
  useLayoutEffect(() => {
    disabledRef.current = disabled;
    onCambiaTrazoRef.current = onCambiaTrazo;
  });

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

  function posicion(canvas: HTMLCanvasElement, clientX: number, clientY: number): Punto {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width) * canvas.width,
      y: ((clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  // CORRECCIÓN URGENTE (ronda 5) — listeners NATIVOS (no props JSX de
  // React) registrados UNA sola vez por montaje del canvas.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    function onDown(e: PointerEvent) {
      if (disabledRef.current) return;
      const c = canvasRef.current;
      if (!c) return;
      try {
        c.setPointerCapture(e.pointerId);
      } catch {
        // best-effort: si el navegador no soporta o rechaza la captura,
        // igual seguimos dibujando con los eventos normales.
      }
      dibujando.current = true;
      trazoActualRef.current = [posicion(c, e.clientX, e.clientY)];
      const eraPrimerTrazo = trazosRef.current.length === 0;
      redibujarTodo();
      persistirRespaldo();
      if (eraPrimerTrazo) onCambiaTrazoRef.current?.(true);
    }

    function onMove(e: PointerEvent) {
      if (!dibujando.current || disabledRef.current) return;
      const c = canvasRef.current;
      if (!c) return;
      trazoActualRef.current.push(posicion(c, e.clientX, e.clientY));
      redibujarTodo();
      // Respaldo continuo durante el arrastre: si ocurriera un remount A
      // MITAD de un trazo, igual hay algo que recuperar.
      if (sesionId) respaldoSesion = { sesionId, trazos: [...trazosRef.current, trazoActualRef.current] };
    }

    function onUp(e: PointerEvent) {
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

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    return () => {
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- registra los listeners UNA vez por montaje; disabled/onCambiaTrazo se leen de refs sincronizados aparte, y sesionId no cambia mientras esta instancia vive.
  }, []);

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
