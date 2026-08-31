"use client";

import { useCallback, useEffect, useState } from "react";
import {
  abreviarHash,
  etiquetaAccion,
  etiquetaMetodo,
  etiquetaOrigenFirma,
  formatearFechaFirma,
} from "@/lib/firmas/historial-firmas-ui";

/**
 * VIATICOS-HISTORIAL-FIRMA-1 — historial de firmas (autorización +
 * liquidación) de UN viático. Componente compartido entre
 * ViaticosControlPanel y ViaticosPorPagarPanel (sección 12 del ticket:
 * el Facturador también debe poder confirmar quién autorizó antes de
 * pagar, SIN que esto le dé ningún permiso de autorizar/liquidar — este
 * modal es de solo lectura, no llama ningún endpoint de escritura).
 *
 * Consume GET /api/empresas/[slug]/tms/viaticos/[id]/firmas y reutiliza
 * EXACTAMENTE el endpoint de imagen ya existente
 * (.../tms/viaticos/firmas/[firmaId]/imagen) — mismo patrón que los
 * modales de "Firma de autorización"/"Firma de liquidación".
 */

type FirmaViatico = {
  id: number;
  accion: string;
  codigoFirma: string;
  fechaHoraServidor: string;
  metodo: string;
  nombreFirmante: string | null;
  rolFirmante: string | null;
  origenFirma: "GUARDADA" | "DIBUJADA" | null;
  tieneImagen: boolean;
  hashPayload: string;
};

export default function HistorialFirmasModal({
  slug,
  viatico,
  onClose,
}: {
  slug: string;
  viatico: { id: number; planCodigo: string; personalNombre: string };
  onClose: () => void;
}) {
  const [firmas, setFirmas] = useState<FirmaViatico[] | null>(null);
  const [error, setError] = useState("");
  const [hashCopiado, setHashCopiado] = useState<number | null>(null);

  const cargar = useCallback(async () => {
    setError("");
    setFirmas(null);
    try {
      const res = await fetch(`/api/empresas/${slug}/tms/viaticos/${viatico.id}/firmas`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? `No se pudo cargar el historial de firmas (${res.status}).`);
        setFirmas([]);
        return;
      }
      setFirmas((data.firmas ?? []) as FirmaViatico[]);
    } catch {
      setError("Error de conexión.");
      setFirmas([]);
    }
  }, [slug, viatico.id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void cargar();
  }, [cargar]);

  async function copiarHash(firmaId: number, hash: string) {
    try {
      await navigator.clipboard.writeText(hash);
      setHashCopiado(firmaId);
      setTimeout(() => setHashCopiado((actual) => (actual === firmaId ? null : actual)), 2000);
    } catch {
      // best-effort — copiar al portapapeles no es una acción crítica.
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg space-y-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">Historial de firmas</h3>
            <p className="mt-0.5 text-xs text-[var(--muted)]">
              Viático: <span className="font-medium text-[var(--text)]">{viatico.planCodigo}</span>
            </p>
            <p className="text-xs text-[var(--muted)]">
              Beneficiario: <span className="font-medium text-[var(--text)]">{viatico.personalNombre}</span>
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded px-2 py-1 text-xs text-[var(--muted)] hover:bg-[var(--input)]">
            Cerrar
          </button>
        </div>

        <div className="max-h-[70vh] space-y-3 overflow-y-auto">
          {firmas === null ? <p className="text-xs text-[var(--muted)]">Cargando…</p> : null}
          {error ? <p className="text-xs text-red-300">{error}</p> : null}
          {firmas !== null && !firmas.length && !error ? (
            <p className="text-xs text-[var(--muted)]">Este viático todavía no tiene firmas registradas.</p>
          ) : null}
          {firmas?.map((f) => (
            <div key={f.id} className="rounded-lg border border-[var(--border)] p-3 text-xs">
              <p className="text-sm font-semibold text-sky-300">{etiquetaAccion(f.accion)}</p>
              {f.tieneImagen ? (
                // eslint-disable-next-line @next/next/no-img-element -- imagen servida por endpoint autenticado propio, no un asset estático de Next.
                <img
                  src={`/api/empresas/${slug}/tms/viaticos/firmas/${f.id}/imagen`}
                  alt="Firma manuscrita"
                  className="my-2 h-20 w-full rounded border border-[var(--border)] bg-white object-contain"
                />
              ) : null}
              <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                <p><span className="text-[var(--muted)]">Firmado por:</span> {f.nombreFirmante ?? "No disponible"}</p>
                <p><span className="text-[var(--muted)]">Rol:</span> {f.rolFirmante ?? "No disponible"}</p>
                <p><span className="text-[var(--muted)]">Fecha:</span> {formatearFechaFirma(f.fechaHoraServidor)}</p>
                <p><span className="text-[var(--muted)]">Código:</span> {f.codigoFirma}</p>
                <p><span className="text-[var(--muted)]">Origen:</span> {etiquetaOrigenFirma(f.origenFirma)}</p>
                <p><span className="text-[var(--muted)]">Método:</span> {etiquetaMetodo(f.metodo)}</p>
              </div>
              <p className="mt-1 flex items-center gap-1">
                <span className="text-[var(--muted)]">Hash:</span>
                <span className="font-mono" title={f.hashPayload}>{abreviarHash(f.hashPayload)}</span>
                <button
                  type="button"
                  onClick={() => void copiarHash(f.id, f.hashPayload)}
                  className="rounded px-1.5 py-0.5 text-[10px] text-[var(--muted)] hover:bg-[var(--input)]"
                >
                  {hashCopiado === f.id ? "Copiado" : "Copiar"}
                </button>
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
