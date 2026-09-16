"use client";

import { useState } from "react";

export function FotoEmpleadoMiniatura({ slug, empleadoId, nombre }: { slug: string; empleadoId: number; nombre: string }) {
  const src = `/api/empresas/${slug}/empleados/${empleadoId}/foto`;
  const [fallida, setFallida] = useState<string>();
  return <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[var(--border)] bg-[var(--input)]">
    {fallida === src ? <span className="text-xs text-[var(--muted)]" aria-label={`Sin fotografía de ${nombre}`}>{nombre.trim().split(/\s+/).slice(0, 2).map((n) => n[0]).join("") || "—"}</span> :
      // La imagen requiere cookies; reutiliza el endpoint privado sin optimizador público.
      // eslint-disable-next-line @next/next/no-img-element
      <img loading="lazy" src={src} alt={`Fotografía de ${nombre}`} className="h-full w-full object-cover" onError={() => setFallida(src)} />}
  </div>;
}
