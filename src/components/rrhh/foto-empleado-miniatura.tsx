"use client";

import { useState } from "react";
import { FotoAmpliada } from "@/components/rrhh/detalle-movimientos-mensual";

/**
 * Miniatura circular de la fotografía del empleado (endpoint privado existente; sin fotografía → iniciales).
 * `ampliable`: al hacer clic abre el MISMO lightbox (FotoAmpliada) que usa el Dashboard RRHH (Escape / clic fuera / Cerrar). Solo una
 * imagen que cargó bien es ampliable. `compacta`: 32 px (listado de Empleados) en lugar de 40 px.
 */
export function FotoEmpleadoMiniatura({ slug, empleadoId, nombre, ampliable = false, compacta = false }: { slug: string; empleadoId: number; nombre: string; ampliable?: boolean; compacta?: boolean }) {
  const src = `/api/empresas/${slug}/empleados/${empleadoId}/foto`;
  const [fallida, setFallida] = useState<string>();
  const [ampliada, setAmpliada] = useState(false);
  const imagen = (
    // La imagen requiere cookies; reutiliza el endpoint privado sin optimizador público.
    // eslint-disable-next-line @next/next/no-img-element
    <img loading="lazy" src={src} alt={`Fotografía de ${nombre}`} className="h-full w-full object-cover" onError={() => setFallida(src)} />
  );
  return <div className={`flex ${compacta ? "h-8 w-8" : "h-10 w-10"} shrink-0 items-center justify-center overflow-hidden rounded-full border border-[var(--border)] bg-[var(--input)]`}>
    {fallida === src ? <span className="text-xs text-[var(--muted)]" aria-label={`Sin fotografía de ${nombre}`}>{nombre.trim().split(/\s+/).slice(0, 2).map((n) => n[0]).join("") || "—"}</span> :
      ampliable ? <button type="button" aria-label={`Ampliar fotografía de ${nombre}`} onClick={(ev) => { ev.stopPropagation(); setAmpliada(true); }} className="h-full w-full cursor-zoom-in focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]">{imagen}</button> : imagen}
    {ampliable && ampliada && fallida !== src ? <FotoAmpliada src={src} nombre={nombre} cerrar={() => setAmpliada(false)} /> : null}
  </div>;
}
