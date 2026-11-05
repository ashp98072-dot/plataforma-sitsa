"use client";

import { useEffect, useMemo, useState } from "react";
import type { FabricaCanal } from "@/lib/borradores/canal";
import type { ContextoBorradores } from "@/lib/borradores/contexto";
import type { NucleoBorradores } from "@/lib/borradores/nucleo";
import type { AlmacenPreferencias } from "@/lib/borradores/preferencia";
import { useBorradorLocal } from "@/lib/borradores/use-borrador-local";
import { useContextoBorradores } from "@/lib/empresa-session";
import { AdvertenciaConflicto } from "@/components/borradores/advertencia-conflicto";
import { ControlPersistenciaLocal } from "@/components/borradores/control-persistencia-local";
import { DialogoRecuperacion } from "@/components/borradores/dialogo-recuperacion";
import { IndicadorAutoguardado } from "@/components/borradores/indicador-autoguardado";
import {
  aEstado, avisosDeRecuperacion, construirPayload, ESQUEMA_REQUERIMIENTO_BORRADOR, hayContenidoEscrito, motivoBloqueoPorBorrador,
  restaurarPayload, type EstadoFormularioRequerimiento, type LineaFormularioOrigen,
} from "@/lib/compras/requerimiento-borrador";
import type { PuenteBorrador } from "@/lib/compras/requerimiento-borrador-envio";

/**
 * BORR-1d — autoguardado LOCAL de «Nuevo requerimiento de compra» (solo creación). Capa de presentación sobre `useBorradorLocal`
 * (BORR-1c): indicador de estado, recuperación explícita, conflicto entre pestañas, preferencia «No guardar en este equipo» y
 * aviso de reconciliación pendiente. No crea nada en MariaDB; el formulario sigue siendo la única vía de envío oficial.
 */
type LineaConAdjuntos = LineaFormularioOrigen & { documentosPendientes?: unknown[] };
/** Inyección SOLO para pruebas (contexto, almacén, preferencias, canal y tiempos); en producción no se pasa nada. */
export type OpcionesInyectablesAutoguardado = { contexto?: ContextoBorradores | null; nucleo?: NucleoBorradores; prefs?: AlmacenPreferencias | null; fabricaCanal?: FabricaCanal | null; debounceMs?: number; maxEsperaMs?: number };
type CatalogosForm = { entidades: { id: number }[]; usuarios: { id: number }[]; requirentesOperaciones: { id: number }[]; proveedores: { id: number }[]; vehiculos: { id: number }[] };

export function AutoguardadoRequerimiento({ fecha, entidad, requirente, encargado, observaciones, lineas, catalogos, fechaHoy, puente, onAplicar, onBloqueo, contexto, nucleo, prefs, fabricaCanal, debounceMs, maxEsperaMs }: {
  fecha: string; entidad: number; requirente: number; encargado: number; observaciones: string; lineas: LineaConAdjuntos[];
  catalogos: CatalogosForm | null;
  fechaHoy: string;
  puente: PuenteBorrador;
  /** El formulario adopta el estado recuperado (nunca se aplica solo). */
  onAplicar: (estado: EstadoFormularioRequerimiento) => void;
  /** Motivo por el que el envío debe esperar (o `null`). */
  onBloqueo: (estado: { motivo: string | null; congelado: boolean }) => void;
  // Inyección para pruebas: por defecto, el contexto autenticado y el IndexedDB reales.
  contexto?: ContextoBorradores | null; nucleo?: NucleoBorradores; prefs?: AlmacenPreferencias | null; fabricaCanal?: FabricaCanal | null; debounceMs?: number; maxEsperaMs?: number;
}) {
  const delProvider = useContextoBorradores();
  const ctx = contexto !== undefined ? contexto : delProvider;
  const estado = useMemo(() => aEstado({ fecha, entidad, requirente, encargado, observaciones, lineas }), [fecha, entidad, requirente, encargado, observaciones, lineas]);
  const payload = useMemo(() => construirPayload(estado), [estado]);
  const borrador = useBorradorLocal({ tipo: "requerimiento_compra", esquemaVersion: ESQUEMA_REQUERIMIENTO_BORRADOR, payload, contexto, nucleo, prefs, fabricaCanal, debounceMs, maxEsperaMs });
  const { snapshot } = borrador;
  const [recuperado, setRecuperado] = useState(false);
  const [errorAplicar, setErrorAplicar] = useState("");

  const avisos = useMemo(() => (recuperado ? avisosDeRecuperacion(estado, catalogos) : []), [recuperado, estado, catalogos]);
  const motivo = motivoBloqueoPorBorrador(snapshot) ?? (avisos.length ? "Revisa los datos recuperados antes de enviar." : null);

  const congelado = snapshot.bloqueo === "envio_en_curso";
  useEffect(() => { onBloqueo({ motivo, congelado }); }, [motivo, congelado, onBloqueo]);
  useEffect(() => { puente.publicar({ snapshot: borrador.snapshot, registrarEnvio: borrador.registrarEnvio, resolverEnvio: borrador.resolverEnvio, descartar: borrador.descartar }); }, [puente, borrador]);
  useEffect(() => () => puente.publicar(null), [puente]);

  const hayContenido = hayContenidoEscrito(estado, fechaHoy) || lineas.some((l) => (l.documentosPendientes?.length ?? 0) > 0);

  function recuperar() {
    const r = borrador.recuperar();
    if (!r.ok) { setErrorAplicar(r.mensaje); return; }
    const restaurado = restaurarPayload(r.payload);
    if (!restaurado.ok) { setErrorAplicar("El borrador guardado no tiene un formato válido y no se aplicó. Puedes descartarlo."); return; }
    setErrorAplicar("");
    onAplicar(restaurado.estado);
    setRecuperado(true);
  }
  async function descartar() {
    const r = await borrador.descartar({ confirmado: true });
    if (!r.ok) setErrorAplicar(r.mensaje);
  }

  const enEspera = snapshot.fase === "en_espera" && snapshot.recuperacion;
  const reconciliacion = snapshot.bloqueo === "envio_en_curso" || snapshot.recuperacion?.situacion === "envio_incierto" || (enEspera && snapshot.estadoEnvio === "enviando");

  return (
    <section aria-label="Borrador local del requerimiento" className="space-y-2 rounded-xl border border-[var(--border)] bg-[var(--card)] p-3">
      <IndicadorAutoguardado snapshot={snapshot} />
      <p className="text-sm text-[var(--muted)]">El borrador se guarda solo en este equipo y no es un requerimiento registrado hasta que lo envíes con «Guardar requerimiento».</p>
      <ControlPersistenciaLocal ownerKey={ctx?.ownerKey ?? null} prefs={prefs} nucleo={nucleo} />
      {recuperado ? <p role="note" className="text-sm text-amber-300">Borrador recuperado. Los documentos adjuntos no se guardan: vuelve a seleccionarlos antes de enviar. Los datos se revalidan al enviar.</p> : null}
      {avisos.length ? <ul role="alert" className="list-disc space-y-1 pl-5 text-sm text-amber-300">{avisos.map((a) => <li key={a}>{a}</li>)}</ul> : null}
      {errorAplicar ? <p role="alert" className="text-sm text-red-300">{errorAplicar}</p> : null}
      {reconciliacion ? (
        <div role="alert" data-reconciliacion-pendiente className="rounded border border-amber-300/60 px-3 py-2 text-sm">
          <p className="font-medium">Reconciliación pendiente</p>
          <p>El último envío no tiene un resultado confirmado. Se conservan el contenido y la clave de envío{snapshot.claveEnvio ? ` (${snapshot.claveEnvio.slice(0, 8)}…)` : ""}; no se creará otro documento ni se cambiará la clave. Si es un reintento en esta misma página, vuelve a pulsar «Guardar requerimiento» (se envía exactamente lo mismo con la misma clave). Si recargaste, revisa en el listado de requerimientos si ya se creó antes de continuar.</p>
        </div>
      ) : null}

      {snapshot.fase === "decision_pendiente" && snapshot.recuperacion ? (
        <DialogoRecuperacion recuperacion={snapshot.recuperacion} hayContenidoActual={hayContenido} onRecuperar={recuperar} onDescartar={descartar} onDecidirDespues={() => borrador.mantener()} />
      ) : null}
      {enEspera && snapshot.recuperacion?.puedeRecuperar ? (
        <button type="button" className="rounded border border-[var(--border)] px-3 py-1 text-sm" onClick={recuperar}>Recuperar el borrador guardado</button>
      ) : null}
      {enEspera && snapshot.recuperacion?.puedeDescartar ? (
        <button type="button" className="ml-2 rounded border border-[var(--border)] px-3 py-1 text-sm" onClick={() => { if (window.confirm("¿Descartar el borrador guardado? No se podrá deshacer.")) void descartar(); }}>Descartar el borrador guardado</button>
      ) : null}
      {snapshot.fase === "conflicto" && snapshot.conflicto ? (
        <AdvertenciaConflicto
          motivo={snapshot.conflicto.motivo}
          onReleer={async () => { const r = await borrador.releer(); return r.ok ? r : { ok: false, mensaje: r.mensaje }; }}
          onAdoptarRemoto={async () => {
            const r = await borrador.adoptarRemoto();
            if (!r.ok) return { ok: false, mensaje: r.mensaje };
            const restaurado = restaurarPayload(r.payload);
            if (!restaurado.ok) return { ok: false, mensaje: "La otra versión no tiene un formato válido." };
            onAplicar(restaurado.estado); setRecuperado(true);
            return { ok: true };
          }}
          onConservarLocal={async () => { const r = await borrador.conservarLocal(); return r.ok ? { ok: true } : { ok: false, mensaje: r.mensaje }; }}
        />
      ) : null}
    </section>
  );
}
