"use client";

import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";

/**
 * BORR-1c — diálogo accesible reutilizable (`alertdialog`) para la interfaz de borradores: foco inicial en la opción segura,
 * Tab atrapado dentro del diálogo, Escape = cancelar (si se indica) y el foco vuelve al elemento que lo tenía al abrirse.
 * Mismo aspecto que los modales existentes de Novalvion (capa oscura + panel con borde).
 */
export function DialogoBase({ titulo, children, acciones, onCancelar, ocupado = false }: {
  titulo: string;
  children: ReactNode;
  /** Botones; el que lleve `data-foco-inicial` recibe el foco (por defecto, el primero). */
  acciones: ReactNode;
  /** Escape. Si se omite, Escape no hace nada. */
  onCancelar?: () => void;
  ocupado?: boolean;
}) {
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  const previo = useRef<Element | null>(null);

  useEffect(() => {
    previo.current = document.activeElement;
    return () => { (previo.current as HTMLElement | null)?.focus?.(); };
  }, []);
  useEffect(() => {
    if (ocupado) return;
    const botones = panel.current?.querySelectorAll<HTMLElement>("button:not([disabled])");
    const inicial = panel.current?.querySelector<HTMLElement>("[data-foco-inicial]:not([disabled])") ?? botones?.[0];
    inicial?.focus();
  });

  function alTeclear(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape" && onCancelar && !ocupado) { e.preventDefault(); onCancelar(); return; }
    if (e.key !== "Tab") return;
    const botones = [...(panel.current?.querySelectorAll<HTMLElement>("button:not([disabled])") ?? [])];
    if (!botones.length) { e.preventDefault(); return; }
    const i = botones.indexOf(document.activeElement as HTMLElement);
    const siguiente = e.shiftKey ? (i <= 0 ? botones.length - 1 : i - 1) : (i === botones.length - 1 ? 0 : i + 1);
    e.preventDefault();
    botones[siguiente]!.focus();
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4" role="presentation">
      <div
        ref={panel}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={`${id}-t`}
        aria-describedby={`${id}-d`}
        onKeyDown={alTeclear}
        className="w-full max-w-md space-y-4 rounded-lg border border-[var(--border)] bg-[var(--panel)] p-5 shadow-xl"
      >
        <h2 id={`${id}-t`} className="text-base font-semibold">{titulo}</h2>
        <div id={`${id}-d`} className="space-y-2 text-sm">{children}</div>
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">{acciones}</div>
      </div>
    </div>
  );
}

export const CLASE_BOTON = "rounded border border-[var(--border)] px-3 py-2 text-sm disabled:opacity-50";
export const CLASE_BOTON_PRINCIPAL = "rounded bg-[var(--accent)] px-3 py-2 text-sm text-white disabled:opacity-50";
