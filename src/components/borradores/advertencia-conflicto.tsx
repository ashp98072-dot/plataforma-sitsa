"use client";

import { useState } from "react";
import type { Borrador } from "@/lib/borradores/tipos";
import type { MotivoConflicto } from "@/lib/borradores/controlador";
import { describirConflicto, describirAntiguedad, formatearFechaHora } from "@/lib/borradores/etiquetas";
import { CLASE_BOTON, CLASE_BOTON_PRINCIPAL, DialogoBase } from "./dialogo-base";

/**
 * BORR-1c — advertencia de CONFLICTO entre pestañas. Nunca fusiona: primero permite ver la versión guardada por la otra pestaña
 * (releer) y luego exige elegir entre usarla o conservar los cambios locales (esta última pide una segunda confirmación porque
 * sobrescribe). El control definitivo sigue siendo la revisión atómica de IndexedDB; esta interfaz solo explica y pide decidir.
 */
export function AdvertenciaConflicto({ motivo, ahora, onReleer, onAdoptarRemoto, onConservarLocal }: {
  motivo: MotivoConflicto;
  ahora?: number;
  onReleer: () => Promise<{ ok: true; remoto: Borrador | null } | { ok: false; mensaje: string }>;
  onAdoptarRemoto: () => Promise<{ ok: boolean; mensaje?: string }>;
  onConservarLocal: () => Promise<{ ok: boolean; mensaje?: string }>;
}) {
  const t = describirConflicto(motivo);
  const [remoto, setRemoto] = useState<Borrador | null | undefined>(undefined);
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [ahoraMs] = useState(() => ahora ?? Date.now()); // fijo durante la vida del diálogo (render puro)

  async function correr(f: () => Promise<{ ok: boolean; mensaje?: string } | { ok: true; remoto: Borrador | null }>, alExito?: (r: never) => void) {
    setOcupado(true); setError("");
    try {
      const r = await f();
      if (!r.ok) setError((r as { mensaje?: string }).mensaje ?? "No se pudo completar la acción.");
      else alExito?.(r as never);
    } finally { setOcupado(false); }
  }

  const existeRemoto = remoto !== null && remoto !== undefined;
  return (
    <DialogoBase
      titulo={confirmando ? "¿Sobrescribir la otra versión?" : t.titulo}
      ocupado={ocupado}
      onCancelar={confirmando ? () => setConfirmando(false) : undefined}
      acciones={confirmando ? (
        <>
          <button type="button" data-foco-inicial className={CLASE_BOTON_PRINCIPAL} disabled={ocupado} onClick={() => setConfirmando(false)}>Volver</button>
          <button type="button" className={CLASE_BOTON} disabled={ocupado} onClick={() => void correr(onConservarLocal)}>Sí, conservar mis cambios</button>
        </>
      ) : (
        <>
          <button type="button" data-foco-inicial className={CLASE_BOTON_PRINCIPAL} disabled={ocupado} onClick={() => void correr(onReleer, (r: { remoto: Borrador | null }) => setRemoto(r.remoto))}>Ver la versión guardada</button>
          <button type="button" className={CLASE_BOTON} disabled={ocupado || remoto === undefined || !existeRemoto} onClick={() => void correr(onAdoptarRemoto)}>Usar la versión de la otra pestaña</button>
          <button type="button" className={CLASE_BOTON} disabled={ocupado || remoto === undefined} onClick={() => setConfirmando(true)}>{existeRemoto ? "Conservar mis cambios" : "Guardar mis cambios de nuevo"}</button>
        </>
      )}
    >
      {confirmando ? (
        <p>La versión guardada por la otra pestaña se <strong>reemplazará</strong> por lo que tienes en esta pantalla. No se podrá recuperar.</p>
      ) : (
        <>
          <p>{t.detalle}</p>
          {remoto === undefined ? <p className="text-[var(--muted)]">Pulsa «Ver la versión guardada» para comparar antes de decidir.</p> : null}
          {remoto === null ? <p role="status">No hay ninguna versión guardada en este equipo.</p> : null}
          {existeRemoto ? <p role="status">Versión guardada: {formatearFechaHora(remoto.actualizadoEn)} ({describirAntiguedad(remoto.actualizadoEn, ahoraMs)}), revisión {remoto.revision}.</p> : null}
          {error ? <p role="alert" className="text-red-300">{error}</p> : null}
        </>
      )}
    </DialogoBase>
  );
}
