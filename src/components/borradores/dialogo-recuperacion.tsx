"use client";

import { useState } from "react";
import type { InfoRecuperacion } from "@/lib/borradores/controlador";
import { describirRecuperacion } from "@/lib/borradores/etiquetas";
import { AdvertenciaBorrador } from "./advertencia-borrador";
import { CLASE_BOTON, CLASE_BOTON_PRINCIPAL, DialogoBase } from "./dialogo-base";

/**
 * BORR-1c — diálogo de recuperación de un borrador local. Tres decisiones: recuperar, descartar (con una segunda confirmación) o
 * decidir después (no se sobrescribe nada). NUNCA restaura solo: si el formulario ya tiene contenido (`hayContenidoActual`) pide
 * una confirmación extra porque recuperar lo reemplaza. Los archivos adjuntos no se guardan y deben solicitarse de nuevo.
 */
export function DialogoRecuperacion({ recuperacion, hayContenidoActual = false, ahora, onRecuperar, onDescartar, onDecidirDespues }: {
  recuperacion: InfoRecuperacion;
  hayContenidoActual?: boolean;
  /** Epoch ms para calcular la antigüedad (inyectable en pruebas). */
  ahora?: number;
  onRecuperar: () => void | Promise<void>;
  /** Se invoca SOLO tras la segunda confirmación. */
  onDescartar: () => void | Promise<void>;
  onDecidirDespues: () => void;
}) {
  const [paso, setPaso] = useState<"decidir" | "confirmar_descarte" | "confirmar_reemplazo">("decidir");
  const [ocupado, setOcupado] = useState(false);
  const [ahoraMs] = useState(() => ahora ?? Date.now()); // fijo durante la vida del diálogo (render puro)

  async function ejecutar(f: () => void | Promise<void>) {
    setOcupado(true);
    try { await f(); } finally { setOcupado(false); }
  }

  if (paso === "confirmar_descarte") {
    return (
      <DialogoBase
        titulo="¿Descartar el borrador?"
        ocupado={ocupado}
        onCancelar={() => setPaso("decidir")}
        acciones={<>
          <button type="button" data-foco-inicial className={CLASE_BOTON_PRINCIPAL} disabled={ocupado} onClick={() => setPaso("decidir")}>Volver</button>
          <button type="button" className={CLASE_BOTON} disabled={ocupado} onClick={() => void ejecutar(onDescartar)}>Sí, descartar definitivamente</button>
        </>}
      >
        <p>El borrador se eliminará de este equipo y <strong>no se podrá deshacer</strong>.</p>
      </DialogoBase>
    );
  }

  if (paso === "confirmar_reemplazo") {
    return (
      <DialogoBase
        titulo="¿Reemplazar lo que ya escribiste?"
        ocupado={ocupado}
        onCancelar={() => setPaso("decidir")}
        acciones={<>
          <button type="button" data-foco-inicial className={CLASE_BOTON_PRINCIPAL} disabled={ocupado} onClick={() => setPaso("decidir")}>Volver</button>
          <button type="button" className={CLASE_BOTON} disabled={ocupado} onClick={() => void ejecutar(onRecuperar)}>Sí, reemplazar con el borrador</button>
        </>}
      >
        <p>El formulario ya tiene contenido. Al recuperar el borrador, ese contenido se <strong>reemplazará</strong>.</p>
      </DialogoBase>
    );
  }

  const bloqueada = !recuperacion.puedeRecuperar && !recuperacion.puedeDescartar;
  return (
    <DialogoBase
      titulo={recuperacion.situacion === "disponible" ? "Encontramos un borrador sin terminar" : "Borrador guardado en este equipo"}
      ocupado={ocupado}
      onCancelar={onDecidirDespues}
      acciones={<>
        <button type="button" className={CLASE_BOTON_PRINCIPAL} data-foco-inicial={recuperacion.puedeRecuperar ? "" : undefined} disabled={!recuperacion.puedeRecuperar || ocupado}
          onClick={() => (hayContenidoActual ? setPaso("confirmar_reemplazo") : void ejecutar(onRecuperar))}>Recuperar borrador</button>
        <button type="button" className={CLASE_BOTON} disabled={!recuperacion.puedeDescartar || ocupado} onClick={() => setPaso("confirmar_descarte")}>Descartar borrador</button>
        <button type="button" className={CLASE_BOTON} data-foco-inicial={recuperacion.puedeRecuperar ? undefined : ""} disabled={ocupado} onClick={onDecidirDespues}>Decidir después</button>
      </>}
    >
      <ul className="space-y-1">{describirRecuperacion(recuperacion, ahoraMs).map((l) => <li key={l}>{l}</li>)}</ul>
      <AdvertenciaBorrador situacion={recuperacion.situacion} />
      <p className="text-[var(--muted)]">Los archivos adjuntos no se guardan: tendrás que adjuntarlos de nuevo.</p>
      <p className="text-[var(--muted)]">«Decidir después» conserva el borrador tal cual; mientras tanto el autoguardado queda en pausa para no sobrescribirlo.</p>
      {bloqueada ? <p role="alert" className="text-amber-300">No hay acciones disponibles sobre este borrador hasta resolver el envío pendiente.</p> : null}
    </DialogoBase>
  );
}
