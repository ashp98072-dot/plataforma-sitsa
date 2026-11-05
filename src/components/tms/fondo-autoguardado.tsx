"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
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
  aFormularioFondo, avisosDeRecuperacionFondo, construirPayloadFondo, ESQUEMA_FONDO_BORRADOR, hayContenidoFondo, motivoBloqueoFondo, restaurarPayloadFondo,
  type CatalogosFondoMin, type EstadoFondoForm,
} from "@/lib/tms/fondo-borrador";
import type { PuenteBorrador } from "@/lib/compras/requerimiento-borrador-envio";

/**
 * BORR-1e — autoguardado LOCAL de «Nueva solicitud de fondo» (solo creación; la página lo monta únicamente cuando NO se edita).
 * Capa de presentación sobre `useBorradorLocal` (BORR-1c) con los patrones de BORR-1d: el adaptador valida ANTES de que el controlador
 * salga de la decisión pendiente, nada se aplica solo y no se crea nada en MariaDB.
 */
export type OpcionesInyectablesAutoguardadoFondo = { contexto?: ContextoBorradores | null; nucleo?: NucleoBorradores; prefs?: AlmacenPreferencias | null; fabricaCanal?: FabricaCanal | null; debounceMs?: number; maxEsperaMs?: number };
/** Inyección SOLO para pruebas (Next no pasa props a las páginas): en producción no hay proveedor y se usan los valores reales. */
export const OpcionesAutoguardadoFondoContext = createContext<OpcionesInyectablesAutoguardadoFondo>({});
type CatalogosForm = CatalogosFondoMin & { empleados: { id: number; cuentaBancaria?: string | null; telefono?: string | null }[] };

export function AutoguardadoFondo({ estadoForm, catalogos, catalogosCargados, puente, onAplicar, onBloqueo }: {
  estadoForm: EstadoFondoForm;
  catalogos: CatalogosForm;
  catalogosCargados: boolean;
  puente: PuenteBorrador;
  /** La página adopta el estado recuperado (nunca se aplica solo). */
  onAplicar: (estado: EstadoFondoForm) => void;
  onBloqueo: (estado: { motivo: string | null; congelado: boolean }) => void;
}) {
  const { contexto, nucleo, prefs, fabricaCanal, debounceMs, maxEsperaMs } = useContext(OpcionesAutoguardadoFondoContext);
  const delProvider = useContextoBorradores();
  const ctx = contexto !== undefined ? contexto : delProvider;
  const [fechaPorDefecto] = useState(() => new Date().toISOString().slice(0, 10));
  const payload = useMemo(() => construirPayloadFondo(estadoForm, catalogos.empleados), [estadoForm, catalogos.empleados]);
  const borrador = useBorradorLocal({ tipo: "solicitud_fondo", esquemaVersion: ESQUEMA_FONDO_BORRADOR, payload, contexto, nucleo, prefs, fabricaCanal, debounceMs, maxEsperaMs });
  const { snapshot } = borrador;
  const [recuperado, setRecuperado] = useState(false);
  const [errorAplicar, setErrorAplicar] = useState("");

  const avisos = useMemo(() => (recuperado && catalogosCargados ? avisosDeRecuperacionFondo(estadoForm, catalogos) : []), [recuperado, catalogosCargados, estadoForm, catalogos]);
  const motivo = motivoBloqueoFondo(snapshot) ?? (avisos.length ? "Revisa los datos recuperados antes de enviar." : null);
  const congelado = snapshot.bloqueo === "envio_en_curso";
  useEffect(() => { onBloqueo({ motivo, congelado }); }, [motivo, congelado, onBloqueo]);
  useEffect(() => () => onBloqueo({ motivo: null, congelado: false }), [onBloqueo]); // al cerrar el formulario no queda ningún bloqueo viejo
  useEffect(() => { puente.publicar({ snapshot: borrador.snapshot, registrarEnvio: borrador.registrarEnvio, resolverEnvio: borrador.resolverEnvio, descartar: borrador.descartar }); }, [puente, borrador]);
  useEffect(() => () => puente.publicar(null), [puente]);

  const hayContenido = hayContenidoFondo(estadoForm, fechaPorDefecto);
  const aceptaAdaptador = (p: unknown) => restaurarPayloadFondo(p).ok;

  function recuperar() {
    if (!catalogosCargados) { setErrorAplicar("Espera a que carguen los catálogos para recuperar el borrador."); return; }
    // El adaptador valida ANTES de que el controlador salga de la decisión pendiente (no destructivo).
    const r = borrador.recuperar(aceptaAdaptador);
    if (!r.ok) { setErrorAplicar(r.mensaje); return; }
    const restaurado = restaurarPayloadFondo(r.payload);
    if (!restaurado.ok) { setErrorAplicar("El borrador guardado no tiene un formato válido y no se aplicó."); return; }
    setErrorAplicar("");
    onAplicar(aFormularioFondo(restaurado.estado, catalogos.empleados));
    setRecuperado(true);
  }
  async function descartar() {
    const r = await borrador.descartar({ confirmado: true });
    if (!r.ok) setErrorAplicar(r.mensaje);
  }

  const enEspera = snapshot.fase === "en_espera" && snapshot.recuperacion;
  const reconciliacion = snapshot.bloqueo === "envio_en_curso" || snapshot.recuperacion?.situacion === "envio_incierto" || (enEspera && snapshot.estadoEnvio === "enviando");

  return (
    <section aria-label="Borrador local de la solicitud" className="space-y-2 rounded border border-[var(--border)]/60 p-2">
      <IndicadorAutoguardado snapshot={snapshot} />
      <p className="text-xs text-[var(--muted)]">El borrador se guarda solo en este equipo y no es una solicitud registrada hasta que pulses «Crear solicitud».</p>
      <ControlPersistenciaLocal ownerKey={ctx?.ownerKey ?? null} prefs={prefs} nucleo={nucleo} />
      {recuperado ? <p role="note" className="text-xs text-amber-300">Borrador recuperado. Los datos se revalidan al enviar.</p> : null}
      {avisos.length ? <ul role="alert" className="list-disc space-y-1 pl-5 text-xs text-amber-300">{avisos.map((a) => <li key={a}>{a}</li>)}</ul> : null}
      {errorAplicar ? <p role="alert" className="text-xs text-red-300">{errorAplicar}</p> : null}
      {reconciliacion ? (
        <div role="alert" data-reconciliacion-pendiente className="rounded border border-amber-300/60 px-3 py-2 text-xs">
          <p className="font-medium">Reconciliación pendiente</p>
          <p>El último envío no tiene un resultado confirmado. Se conservan el contenido y la clave de envío{snapshot.claveEnvio ? ` (${snapshot.claveEnvio.slice(0, 8)}…)` : ""}; no se creará otra solicitud ni se cambiará la clave. Si es un reintento en esta misma página, vuelve a pulsar «Crear solicitud» (se envía exactamente lo mismo con la misma clave). Si recargaste, revisa en el listado si la solicitud ya se creó antes de continuar.</p>
        </div>
      ) : null}

      {snapshot.fase === "decision_pendiente" && snapshot.recuperacion ? (
        <DialogoRecuperacion recuperacion={snapshot.recuperacion} hayContenidoActual={hayContenido} onRecuperar={recuperar} onDescartar={descartar} onDecidirDespues={() => borrador.mantener()} />
      ) : null}
      {enEspera && snapshot.recuperacion?.puedeRecuperar ? (
        <button type="button" className="rounded border border-[var(--border)] px-3 py-1 text-xs" onClick={recuperar}>Recuperar el borrador guardado</button>
      ) : null}
      {enEspera && snapshot.recuperacion?.puedeDescartar ? (
        <button type="button" className="ml-2 rounded border border-[var(--border)] px-3 py-1 text-xs" onClick={() => { if (window.confirm("¿Descartar el borrador guardado? No se podrá deshacer.")) void descartar(); }}>Descartar el borrador guardado</button>
      ) : null}
      {snapshot.fase === "conflicto" && snapshot.conflicto ? (
        <AdvertenciaConflicto
          motivo={snapshot.conflicto.motivo}
          onReleer={async () => { const r = await borrador.releer(); return r.ok ? r : { ok: false, mensaje: r.mensaje }; }}
          onAdoptarRemoto={async () => {
            const r = await borrador.adoptarRemoto(aceptaAdaptador);
            if (!r.ok) return { ok: false, mensaje: r.mensaje };
            const restaurado = restaurarPayloadFondo(r.payload);
            if (!restaurado.ok) return { ok: false, mensaje: "La otra versión no tiene un formato válido." };
            onAplicar(aFormularioFondo(restaurado.estado, catalogos.empleados)); setRecuperado(true);
            return { ok: true };
          }}
          onConservarLocal={async () => { const r = await borrador.conservarLocal(); return r.ok ? { ok: true } : { ok: false, mensaje: r.mensaje }; }}
        />
      ) : null}
    </section>
  );
}
