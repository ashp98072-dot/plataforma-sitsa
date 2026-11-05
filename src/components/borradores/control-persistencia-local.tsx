"use client";

import { useId, useState, useSyncExternalStore } from "react";
import { crearAlmacenIndexedDB } from "@/lib/borradores/almacen-indexeddb";
import { desactivarPersistencia, textoAdvertenciaLimpieza, type InformeLimpieza, type ResumenBorradoresUsuario } from "@/lib/borradores/cierre-sesion";
import { esperarEscriturasEnVueloDe } from "@/lib/borradores/coordinacion";
import { crearNucleoBorradores, type NucleoBorradores } from "@/lib/borradores/nucleo";
import {
  almacenPreferenciasDelNavegador, CLAVE_PREFERENCIA_PERSISTENCIA, EVENTO_PREFERENCIA, fijarPersistencia, notificarCambioPreferencia, persistenciaActiva,
  type AlmacenPreferencias,
} from "@/lib/borradores/preferencia";
import { CLASE_BOTON, CLASE_BOTON_PRINCIPAL, DialogoBase } from "./dialogo-base";

/**
 * BORR-1c — control visual «No guardar borradores en este equipo» (equipos compartidos). Desactivar pide confirmación informada
 * cuando hay borradores del usuario (se eliminan, de forma irreversible) y nunca declara éxito sin confirmación del almacenamiento:
 * si la eliminación no se completa, la preferencia queda desactivada y se muestra el estado real con opción de reintentar. La
 * preferencia es del EQUIPO (localStorage, valor no sensible) y se refleja al instante en las demás pestañas.
 */
export function ControlPersistenciaLocal({ ownerKey, prefs, nucleo, onCambio }: {
  ownerKey: string | null;
  /** Inyectable en pruebas; por defecto, localStorage del navegador. */
  prefs?: AlmacenPreferencias | null;
  /** Núcleo con el almacén REAL (no el envoltorio de preferencia): la limpieza debe poder borrar aun con la persistencia desactivada. */
  nucleo?: NucleoBorradores;
  onCambio?: (persistenciaActiva: boolean) => void;
}) {
  const id = useId();
  const almacenPrefs = prefs !== undefined ? prefs : almacenPreferenciasDelNavegador();
  const activa = useSyncExternalStore(
    (aviso) => {
      window.addEventListener("storage", aviso);
      window.addEventListener(EVENTO_PREFERENCIA, aviso);
      return () => { window.removeEventListener("storage", aviso); window.removeEventListener(EVENTO_PREFERENCIA, aviso); };
    },
    () => persistenciaActiva(almacenPrefs),
    () => true,
  );
  void CLAVE_PREFERENCIA_PERSISTENCIA;
  const [confirmacion, setConfirmacion] = useState<{ resumen: ResumenBorradoresUsuario; resolver: (si: boolean) => void } | null>(null);
  const [mensaje, setMensaje] = useState<{ tipo: "ok" | "aviso" | "error"; texto: string } | null>(null);
  const [residuos, setResiduos] = useState<InformeLimpieza | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function desactivar() {
    setOcupado(true); setMensaje(null); setResiduos(null);
    try {
      const nucleoLimpieza = nucleo ?? crearNucleoBorradores({ almacen: crearAlmacenIndexedDB(), appBuild: "control-persistencia" });
      const r = await desactivarPersistencia({
        ownerKey, nucleo: nucleoLimpieza, prefs: almacenPrefs,
        confirmar: (resumen) => new Promise<boolean>((resolver) => setConfirmacion({ resumen, resolver })),
        // Los autoguardados de esta página se pausan ya y se espera a sus escrituras en vuelo antes de eliminar.
        antesDeBorrar: async () => { notificarCambioPreferencia(); if (ownerKey) await esperarEscriturasEnVueloDe(ownerKey); },
      });
      notificarCambioPreferencia();
      onCambio?.(persistenciaActiva(almacenPrefs));
      if (r.estado === "desactivada") setMensaje({ tipo: "ok", texto: r.detectados > 0 ? "Se dejó de guardar borradores en este equipo y se eliminaron los existentes." : "Se dejó de guardar borradores en este equipo." });
      else if (r.estado === "cancelada") setMensaje({ tipo: "aviso", texto: "No se hizo ningún cambio." });
      else if (r.estado === "no_aplicada") setMensaje({ tipo: "error", texto: "No se pudo aplicar el cambio en este navegador. No se eliminó nada." });
      else if (r.informe) { setResiduos(r.informe); setMensaje({ tipo: "error", texto: "Se dejó de guardar borradores, pero la eliminación de los existentes no se confirmó por completo." }); }
    } finally {
      setConfirmacion(null);
      setOcupado(false);
    }
  }

  function reactivar() {
    setMensaje(null); setResiduos(null);
    if (!fijarPersistencia(almacenPrefs, true)) { setMensaje({ tipo: "error", texto: "No se pudo reactivar el guardado en este navegador." }); return; }
    notificarCambioPreferencia();
    onCambio?.(true);
  }

  const textoResiduos = residuos ? textoAdvertenciaLimpieza(residuos) : null;
  return (
    <div className="space-y-2 text-sm">
      <label className="flex items-start gap-2" htmlFor={`${id}-no-guardar`}>
        <input id={`${id}-no-guardar`} type="checkbox" role="switch" className="mt-1" checked={!activa} disabled={ocupado} aria-describedby={`${id}-ayuda`}
          onChange={(e) => (e.target.checked ? void desactivar() : reactivar())} />
        <span>No guardar borradores en este equipo</span>
      </label>
      <p id={`${id}-ayuda`} className="text-xs text-[var(--muted)]">
        Úsalo en equipos compartidos. Al activarlo se eliminan los borradores guardados aquí y no se guardarán nuevos. El contenido no se guarda en ningún otro lugar.
      </p>
      {mensaje ? <p role={mensaje.tipo === "error" ? "alert" : "status"} className={mensaje.tipo === "error" ? "text-red-300" : mensaje.tipo === "aviso" ? "text-amber-300" : "text-emerald-400"}>{mensaje.texto}</p> : null}
      {textoResiduos ? (
        <div role="alert" className="space-y-2 rounded border border-red-400/60 px-3 py-2">
          <p className="font-medium">{textoResiduos.titulo}</p>
          <p>{textoResiduos.detalle}</p>
          <button type="button" className={CLASE_BOTON} disabled={ocupado} onClick={() => void desactivar()}>Reintentar eliminación</button>
        </div>
      ) : null}
      {confirmacion ? (
        <DialogoBase
          titulo="¿Eliminar los borradores de este equipo?"
          onCancelar={() => confirmacion.resolver(false)}
          acciones={<>
            <button type="button" data-foco-inicial className={CLASE_BOTON_PRINCIPAL} onClick={() => confirmacion.resolver(false)}>Cancelar</button>
            <button type="button" className={CLASE_BOTON} onClick={() => confirmacion.resolver(true)}>Sí, eliminar y no guardar</button>
          </>}
        >
          <p>Hay {confirmacion.resumen.total === 1 ? "1 borrador" : `${confirmacion.resumen.total} borradores`} guardado(s) solo en este equipo, aún sin respaldo en el servidor.</p>
          <p>Si continúas se <strong>eliminarán</strong> y no se podrán recuperar.</p>
        </DialogoBase>
      ) : null}
    </div>
  );
}
