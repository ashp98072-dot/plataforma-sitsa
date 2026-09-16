"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { DetalleMovimientosMensual, MovimientoMensual } from "@/lib/rrhh/dashboard";

function Miniatura({ slug, persona }: { slug: string; persona: MovimientoMensual }) {
  const [fallida, setFallida] = useState(false);
  return <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[var(--border)] bg-[var(--input)]">
    {fallida ? <span aria-label={`Sin fotografía de ${persona.nombre}`}>{persona.nombre.trim().split(/\s+/).slice(0, 2).map((n) => n[0]).join("") || "—"}</span> :
      // Endpoint privado existente; conserva las cookies de sesión.
      // eslint-disable-next-line @next/next/no-img-element
      <img loading="lazy" src={`/api/empresas/${slug}/empleados/${persona.id}/foto`} alt={`Fotografía de ${persona.nombre}`} className="h-full w-full object-cover" onError={() => setFallida(true)} />}
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
