"use client";

import { describirSituacion } from "@/lib/borradores/etiquetas";
import type { SituacionRecuperacion } from "@/lib/borradores/controlador";

/**
 * BORR-1c — advertencia de un borrador incompatible, expirado, dañado, de versión anterior, ya enviado o con envío sin resolver.
 * Reutilizable dentro del diálogo de recuperación o suelta en un formulario.
 */
export function AdvertenciaBorrador({ situacion }: { situacion: SituacionRecuperacion }) {
  const t = describirSituacion(situacion);
  return (
    <div role="note" data-situacion={situacion} className={`rounded border px-3 py-2 ${t.tono === "error" ? "border-red-400/60" : t.tono === "aviso" ? "border-amber-300/60" : "border-[var(--border)]"}`}>
      <p className="font-medium">{t.titulo}</p>
      <p className="text-[var(--muted)]">{t.detalle}</p>
    </div>
  );
}
