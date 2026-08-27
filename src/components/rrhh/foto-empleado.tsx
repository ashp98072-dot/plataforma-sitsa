"use client";

import { useState } from "react";

export function FotoEmpleado({ src, nombre }: { src?: string; nombre: string }) {
  const [fallida, setFallida] = useState<string>();
  return (
    <div className="flex h-36 w-32 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--input)]">
      {src && fallida !== src ? (
        // Requiere cookies de la sesión: no pasar por el optimizador público.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={`Fotografía de ${nombre || "empleado"}`} className="h-full w-full object-cover" onError={() => setFallida(src)} />
      ) : <span className="px-2 text-center text-xs text-[var(--muted)]">Sin fotografía</span>}
    </div>
  );
}
