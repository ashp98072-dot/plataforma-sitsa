"use client";
import { useEffect, useState } from "react";
import { useEmpresaSession } from "@/lib/empresa-session";
import { tieneAccionCatalogo, tienePermisoBase } from "@/lib/permisos-catalogo";
import { lineaBitacora, type EventoBitacoraVista } from "@/lib/facturacion/bitacora-formato";

/** Historial (bitácora) de UNA factura: quién, cuándo y qué. Solo lectura. Requiere la acción propia `ver_bitacora`; sin ella no se muestra ni se consulta. */
export function BitacoraFacturaPanel({ slug, facturaId }: { slug: string; facturaId: number }) {
  const { permisos, rol } = useEmpresaSession();
  const puedeVer = (rol === "Admin" || tienePermisoBase(permisos, "facturacion")) && (rol === "Admin" || tieneAccionCatalogo(permisos, "facturacion", "ver_bitacora"));
  const [eventos, setEventos] = useState<EventoBitacoraVista[] | null>(null);
  const [error, setError] = useState("");
  const [abierto, setAbierto] = useState(false);
  useEffect(() => {
    if (!puedeVer || !abierto) return;
    const ac = new AbortController();
    fetch(`/api/empresas/${encodeURIComponent(slug)}/facturacion/facturas/${facturaId}/bitacora`, { cache: "no-store", signal: ac.signal })
      .then(async (r) => ({ ok: r.ok, d: await r.json() }))
      .then(({ ok, d }) => { if (ac.signal.aborted) return; if (ok) { setEventos(d.eventos); setError(""); } else setError(d.error ?? "No se pudo cargar la bitácora."); })
      .catch(() => { if (!ac.signal.aborted) setError("No se pudo cargar la bitácora."); });
    return () => ac.abort();
  }, [slug, facturaId, puedeVer, abierto]);
  if (!puedeVer) return null;
  return (
    <div className="space-y-1 text-xs">
      <button type="button" className="font-medium underline" aria-expanded={abierto} onClick={() => setAbierto(!abierto)}>{abierto ? "Ocultar bitácora" : "Bitácora de la factura"}</button>
      {abierto && (
        <div>
          {error ? <p role="alert" className="text-rose-500">{error}</p> : null}
          {eventos && eventos.length === 0 ? <p className="text-[var(--muted)]">Sin movimientos registrados.</p> : null}
          <ul className="space-y-0.5">{eventos?.map((e) => <li key={e.id}>{lineaBitacora(e)}</li>)}</ul>
        </div>
      )}
    </div>
  );
}
