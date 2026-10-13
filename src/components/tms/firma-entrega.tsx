"use client";

import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import FirmaCanvas, { type FirmaCanvasHandle } from "@/components/tms/firma-canvas";
import SelectorFirma from "@/components/tms/selector-firma";

/**
 * CONTROL DE ENTREGA — captura de firma reutilizando los componentes del sistema (SelectorFirma/FirmaCanvas y «Mi firma»): no
 * hay un mecanismo nuevo. El servidor es quien lee la firma guardada del usuario de la SESIÓN y valida el PNG; aquí solo se
 * decide qué mostrar y se arma el multipart (`usarFirmaGuardada=true` | `firmaImagen`).
 *
 * El componente es dueño de su estado (firma guardada / trazo) y expone, por `handleRef`, `agregarA(fd)`; avisa por
 * `onListaCambia` cuando ya hay algo que firmar (para habilitar el botón de envío).
 *
 * `soloDibujada`: recepción presencial — quien recibe no tiene usuario, así que la firma guardada no aplica y el trazo es obligatorio.
 */
export type FirmaEntregaHandle = {
  /** Agrega la firma al multipart; devuelve un mensaje de error si falta, o null. */
  agregarA: (fd: FormData) => Promise<string | null>;
};

export function FirmaEntregaCampos({
  slug,
  sesionId,
  handleRef,
  onListaCambia,
  soloDibujada = false,
  disabled,
}: {
  slug: string;
  sesionId: string;
  handleRef: Ref<FirmaEntregaHandle>;
  onListaCambia: (lista: boolean) => void;
  soloDibujada?: boolean;
  disabled?: boolean;
}) {
  const canvasRef = useRef<FirmaCanvasHandle>(null);
  const [tieneGuardada, setTieneGuardada] = useState<boolean | null>(soloDibujada ? false : null);
  const [usarGuardada, setUsarGuardada] = useState(false);
  const [tieneTrazo, setTieneTrazo] = useState(false);

  useEffect(() => {
    if (soloDibujada) return;
    let vigente = true;
    fetch(`/api/empresas/${slug}/mi-firma`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        return res.ok ? Boolean(data.tieneFirma) : false;
      })
      .catch(() => false)
      .then((tiene) => {
        if (!vigente) return;
        setTieneGuardada(tiene);
        setUsarGuardada(tiene);
      });
    return () => { vigente = false; };
  }, [slug, soloDibujada]);

  const agregarA = useCallback(async (fd: FormData): Promise<string | null> => {
    if (!soloDibujada && tieneGuardada && usarGuardada) {
      fd.set("usarFirmaGuardada", "true");
      return null;
    }
    const imagen = await canvasRef.current?.obtenerImagen();
    if (!imagen) return "Dibuja tu firma antes de continuar.";
    fd.set("firmaImagen", imagen, "firma.png");
    return null;
  }, [soloDibujada, tieneGuardada, usarGuardada]);

  useImperativeHandle(handleRef, () => ({ agregarA }), [agregarA]);

  const lista = soloDibujada ? tieneTrazo : usarGuardada || tieneTrazo;
  useEffect(() => { onListaCambia(lista); }, [lista, onListaCambia]);

  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-[var(--muted)]">Firma{soloDibujada ? " de quien recibe (dibujada)" : ""}</p>
      {soloDibujada ? (
        <FirmaCanvas ref={canvasRef} sesionId={sesionId} onCambiaTrazo={setTieneTrazo} disabled={disabled} />
      ) : (
        <SelectorFirma
          slug={slug}
          tieneFirmaGuardada={tieneGuardada}
          usarGuardada={usarGuardada}
          onCambiaUsarGuardada={setUsarGuardada}
          canvasRef={canvasRef}
          sesionId={sesionId}
          onCambiaTrazo={setTieneTrazo}
          disabled={disabled}
        />
      )}
    </div>
  );
}
