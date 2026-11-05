"use client";

import { describirEstadoAutoguardado, type Tono } from "@/lib/borradores/etiquetas";
import type { SnapshotBorrador } from "@/lib/borradores/controlador";

/**
 * BORR-1c — indicador del estado del autoguardado. `role="status"` (región viva educada): el lector de pantalla anuncia los cambios
 * sin robar el foco. Solo habla de «este equipo» y nunca muestra «Guardado» antes de la confirmación de IndexedDB.
 */
const COLORES: Record<Tono, string> = {
  neutro: "text-[var(--muted)]",
  info: "text-[var(--text)]",
  ok: "text-emerald-400",
  aviso: "text-amber-300",
  error: "text-red-300",
};

export function IndicadorAutoguardado({ snapshot, className = "" }: { snapshot: SnapshotBorrador; className?: string }) {
  const e = describirEstadoAutoguardado(snapshot);
  return (
    <p role="status" aria-live="polite" data-estado-autoguardado={snapshot.fase === "activo" ? snapshot.guardado.estado : snapshot.fase} className={`text-xs ${COLORES[e.tono]} ${className}`}>
      <span className="font-medium">{e.texto}</span>
      {e.detalle ? <span className="ml-1 text-[var(--muted)]">{e.detalle}</span> : null}
    </p>
  );
}
