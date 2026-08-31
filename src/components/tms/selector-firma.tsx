"use client";

import type { Ref } from "react";
import FirmaCanvas, { type FirmaCanvasHandle } from "@/components/tms/firma-canvas";

/**
 * MI-FIRMA-1 — selector reutilizable entre "usar mi firma guardada" (si
 * el usuario tiene una plantilla personal registrada en "Mi firma") y
 * "dibujar otra firma" (el FirmaCanvas de siempre). Usado en los 3
 * modales de firma de ViaticosControlPanel (autorizar individual,
 * liquidación, autorizar seleccionados) para no triplicar esta lógica.
 *
 * Solo decide QUÉ MOSTRAR y guarda la elección (`usarGuardada`) — el
 * padre sigue siendo responsable de: obtener el File final al confirmar
 * (canvasRef.current.obtenerImagen() si se dibuja) y de armar el
 * FormData con `usarFirmaGuardada=true` cuando corresponda. La copia
 * física independiente para firmas_electronicas la genera SIEMPRE el
 * servidor (ver autorizarViatico/liquidarViatico) — este componente
 * nunca sube ni copia nada.
 */
export default function SelectorFirma({
  slug,
  tieneFirmaGuardada,
  usarGuardada,
  onCambiaUsarGuardada,
  canvasRef,
  sesionId,
  onCambiaTrazo,
  disabled,
}: {
  slug: string;
  /** `null` mientras se está consultando GET /mi-firma. */
  tieneFirmaGuardada: boolean | null;
  usarGuardada: boolean;
  onCambiaUsarGuardada: (v: boolean) => void;
  canvasRef: Ref<FirmaCanvasHandle>;
  sesionId: string;
  onCambiaTrazo: (v: boolean) => void;
  disabled?: boolean;
}) {
  if (tieneFirmaGuardada === null) {
    return <p className="text-xs text-[var(--muted)]">Cargando…</p>;
  }

  return (
    <div className="space-y-2">
      {tieneFirmaGuardada ? (
        <div className="flex flex-col gap-1 text-xs">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              checked={usarGuardada}
              onChange={() => onCambiaUsarGuardada(true)}
              disabled={disabled}
            />
            Usar mi firma guardada
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              checked={!usarGuardada}
              onChange={() => onCambiaUsarGuardada(false)}
              disabled={disabled}
            />
            Dibujar otra firma
          </label>
        </div>
      ) : (
        <p className="text-[10px] text-[var(--muted)]">
          No tienes una firma guardada. Puedes registrar una desde &quot;Mi firma&quot;.
        </p>
      )}
      {tieneFirmaGuardada && usarGuardada ? (
        // eslint-disable-next-line @next/next/no-img-element -- imagen servida por endpoint autenticado propio (GET /mi-firma/imagen), no un asset estático de Next.
        <img
          src={`/api/empresas/${slug}/mi-firma/imagen`}
          alt="Mi firma guardada"
          className="h-20 w-full rounded border border-[var(--border)] bg-white object-contain"
        />
      ) : (
        <FirmaCanvas ref={canvasRef} sesionId={sesionId} onCambiaTrazo={onCambiaTrazo} disabled={disabled} />
      )}
    </div>
  );
}
