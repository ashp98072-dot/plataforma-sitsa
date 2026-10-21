"use client";

import { useEffect, useRef } from "react";
import { MAX_ERRORES_VISIBLES, errorDeCampo, resumirErrores, type ErrorFormulario } from "@/lib/validacion-formulario";

/**
 * Resumen visible de errores de validación, cerca del botón Guardar/Crear (sin ventanas emergentes). Al recibir un conjunto NUEVO de errores
 * hace scroll hasta el resumen y le da el foco UNA sola vez (no vuelve a saltar mientras el usuario corrige). Con muchos errores
 * muestra los primeros y resume el resto ("+ N errores adicionales.").
 */
export function ErroresFormulario({ errores, titulo = "Hay datos que debes corregir:", max = MAX_ERRORES_VISIBLES }: { errores: ErrorFormulario[]; titulo?: string; max?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!errores.length) return;
    const el = ref.current;
    if (!el) return;
    el.scrollIntoView?.({ behavior: "smooth", block: "center" });
    el.focus?.({ preventScroll: true });
  }, [errores]);
  if (!errores.length) return null;
  return (
    <div ref={ref} tabIndex={-1} role="alert" aria-live="assertive" className="rounded-lg border border-red-500/60 bg-red-950/30 p-3 text-sm text-red-200 outline-none">
      <p className="font-medium">{titulo}</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5">
        {resumirErrores(errores, max).map((t, i) => <li key={`${i}-${t}`}>{t}</li>)}
      </ul>
    </div>
  );
}

/** Texto pequeño bajo un campo inválido (si el servidor señaló ese campo). */
export function ErrorCampo({ errores, campo }: { errores: ErrorFormulario[]; campo: string }) {
  const m = errorDeCampo(errores, campo);
  return m ? <span className="mt-0.5 block text-[10px] text-red-300">{m.charAt(0).toUpperCase() + m.slice(1)}</span> : null;
}

/** Agrega el borde de error al className de un campo inválido. */
export function claseCampo(errores: ErrorFormulario[], campo: string, base: string): string {
  return errores.some((e) => e.campo === campo) ? `${base} !border-red-500` : base;
}
