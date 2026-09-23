"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import type { DetalleMovimientosMensual, MovimientoMensual } from "@/lib/rrhh/dashboard";

/**
 * RRHH-DASHBOARD-BAJAS-FOTO-1 — fotografía ampliada. Lightbox sobre la
 * pantalla (no abre pestaña): fondo oscuro, imagen completa con
 * `object-contain` (sin deformar, limitada a 90vw × 85vh), nombre del
 * empleado, botón Cerrar, clic fuera de la imagen y Escape cierran.
 * Reutiliza la MISMA URL del endpoint privado de la miniatura (el navegador
 * resuelve/cachea la misma imagen): no hay endpoint nuevo.
 * Accesible: role="dialog" aria-modal, nombre accesible = nombre del
 * empleado; el foco entra al botón Cerrar, Tab se queda dentro y al cerrar
 * el foco vuelve a la miniatura que lo abrió.
 */
export function FotoAmpliada({ src, nombre, cerrar }: { src: string; nombre: string; cerrar: () => void }) {
  const tituloId = useId();
  const cerrarRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previo = document.activeElement as HTMLElement | null;
    cerrarRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { e.preventDefault(); cerrar(); }
      else if (e.key === "Tab") { e.preventDefault(); cerrarRef.current?.focus(); }
    }
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); previo?.focus?.(); };
  }, [cerrar]);
  return createPortal(
    <div data-foto-fondo className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={cerrar}>
      <div role="dialog" aria-modal="true" aria-labelledby={tituloId} className="flex max-h-full max-w-full flex-col items-center gap-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex w-full items-center justify-between gap-4">
          <p id={tituloId} className="text-sm font-medium text-white">{nombre}</p>
          <button ref={cerrarRef} type="button" onClick={cerrar} className="rounded border border-white/40 px-3 py-1 text-sm text-white hover:bg-white/10">Cerrar</button>
        </div>
        {/* Misma URL privada de la miniatura; conserva las cookies de sesión. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={`Fotografía de ${nombre}`} className="max-h-[85vh] max-w-[90vw] rounded-lg object-contain" />
      </div>
    </div>,
    document.body,
  );
}

export function Miniatura({ slug, persona }: { slug: string; persona: MovimientoMensual }) {
  const [fallida, setFallida] = useState(false);
  const [ampliada, setAmpliada] = useState(false);
  const src = `/api/empresas/${slug}/empleados/${persona.id}/foto`;
  return <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[var(--border)] bg-[var(--input)]">
    {fallida ? <span aria-label={`Sin fotografía de ${persona.nombre}`}>{persona.nombre.trim().split(/\s+/).slice(0, 2).map((n) => n[0]).join("") || "—"}</span> :
      // Solo una fotografía válida es ampliable: si falla, se muestran iniciales (no clicables) y no hay modal.
      <button type="button" aria-label={`Ampliar fotografía de ${persona.nombre}`} onClick={() => setAmpliada(true)} className="h-full w-full cursor-zoom-in focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]">
        {/* Endpoint privado existente; conserva las cookies de sesión. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img loading="lazy" src={src} alt={`Fotografía de ${persona.nombre}`} className="h-full w-full object-cover" onError={() => setFallida(true)} />
      </button>}
    {ampliada && !fallida ? <FotoAmpliada src={src} nombre={persona.nombre} cerrar={() => setAmpliada(false)} /> : null}
  </div>;
}

export function DetalleMovimientosPanel({ slug, mes, cerrar }: { slug: string; mes: string; cerrar: () => void }) {
  const [detalle, setDetalle] = useState<DetalleMovimientosMensual | null>(null);
  const [error, setError] = useState("");
  const [intento, setIntento] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const res = await fetch(`/api/empresas/${slug}/rrhh/dashboard?detalleMes=${encodeURIComponent(mes)}`, { cache: "no-store", signal: controller.signal });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Detalle no disponible.");
        if (!controller.signal.aborted) setDetalle(data);
      } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Error de conexión."); }
    })();
    return () => controller.abort();
  }, [slug, mes, intento]);
  return <section id="detalle-movimientos" aria-label={`Altas y bajas de ${mes}`} className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
    <div className="flex items-center justify-between gap-3"><h2 className="font-semibold">Detalle mensual · {mes}</h2><button type="button" onClick={cerrar} className="underline">Cerrar detalle</button></div>
    {error ? <p role="alert">{error} <button type="button" onClick={() => { setError(""); setIntento((i) => i + 1); }} className="underline">Reintentar</button></p> : !detalle ? <p role="status">Cargando movimientos…</p> :
      <div className="mt-4 grid gap-6 lg:grid-cols-2">{(["altas", "bajas"] as const).map((tipo) => <div key={tipo}>
        <h3 className="font-medium">{tipo === "altas" ? "Altas del mes" : "Bajas del mes"} ({detalle[tipo].length})</h3>
        {!detalle[tipo].length ? <p className="mt-2 text-sm text-[var(--muted)]">Sin movimientos en este mes.</p> : <ul>{detalle[tipo].map((persona) => <li key={persona.id} className="flex items-center gap-3 border-b border-[var(--border)] py-3">
          <Miniatura slug={slug} persona={persona} /><div className="min-w-0 text-sm"><p>{persona.nombre}</p><p className="text-[var(--muted)]">{persona.codigo} · {persona.puesto || "—"}</p>
            <p>{tipo === "altas" ? "Fecha de alta" : "Fecha de egreso"}: {tipo === "altas" ? persona.fechaAlta : persona.fechaEgreso}</p>
            <Link href={`/e/${slug}/rrhh/empleados?empleado=${persona.id}`} prefetch={false} className="text-[var(--accent)] underline">{persona.esBaja ? "Ver ficha e histórico" : "Ver ficha"}</Link>
          </div></li>)}</ul>}
      </div>)}</div>}
  </section>;
}
