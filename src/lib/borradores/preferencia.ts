import { crearAlmacenDesactivado, type AlmacenBorradores } from "./almacen";

/**
 * BORR-1b — preferencia «No guardar borradores en este equipo» (equipos compartidos).
 *
 * Es una preferencia del EQUIPO/NAVEGADOR (no del usuario) guardada en localStorage con un valor fijo no sensible: NO contiene
 * secretos, identidades ni contenido de borradores. Un equipo marcado como compartido deja de persistir borradores para
 * cualquiera que lo use. Ante un localStorage ilegible se asume el comportamiento por defecto (persistencia activa); es una
 * comodidad de privacidad, no un control de seguridad.
 */
export const CLAVE_PREFERENCIA_PERSISTENCIA = "novalvion.borradores.persistencia";
const VALOR_DESACTIVADA = "desactivada";

/**
 * BORR-1c — evento de ESTA pestaña cuando cambia la preferencia (el evento `storage` solo llega a las OTRAS pestañas). Los
 * controladores de autoguardado lo escuchan para pausar o reanudar al instante.
 */
export const EVENTO_PREFERENCIA = "novalvion:borradores-preferencia";

/** Avisa a los controladores de esta pestaña de que cambió la preferencia. No-op fuera del navegador. */
export function notificarCambioPreferencia(): void {
  try { if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENTO_PREFERENCIA)); } catch { /* sin DOM */ }
}

export type AlmacenPreferencias = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** `localStorage` del navegador o `null` (SSR, modo restringido, acceso bloqueado). */
export function almacenPreferenciasDelNavegador(): AlmacenPreferencias | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function persistenciaActiva(prefs: AlmacenPreferencias | null): boolean {
  if (!prefs) return true;
  try {
    return prefs.getItem(CLAVE_PREFERENCIA_PERSISTENCIA) !== VALOR_DESACTIVADA;
  } catch {
    return true;
  }
}

/** `true` si la preferencia quedó escrita; `false` si el navegador no la pudo guardar (no se debe asumir que se aplicó). */
export function fijarPersistencia(prefs: AlmacenPreferencias | null, activa: boolean): boolean {
  if (!prefs) return false;
  try {
    if (activa) prefs.removeItem(CLAVE_PREFERENCIA_PERSISTENCIA);
    else prefs.setItem(CLAVE_PREFERENCIA_PERSISTENCIA, VALOR_DESACTIVADA);
    return persistenciaActiva(prefs) === activa;
  } catch {
    return false;
  }
}

/**
 * Envuelve un almacén para AUTOGUARDADO: la preferencia se consulta en CADA operación (otra pestaña puede cambiarla). Con la
 * persistencia desactivada, nada se lee ni se escribe. La limpieza administrativa (cierre de sesión, desactivar) NO debe
 * usar este envoltorio sino el almacén real: debe poder borrar aun con la persistencia ya desactivada.
 */
export function crearAlmacenSegunPreferencia(base: AlmacenBorradores, prefs: AlmacenPreferencias | null): AlmacenBorradores {
  const desactivado = crearAlmacenDesactivado();
  const elegir = () => (persistenciaActiva(prefs) ? base : desactivado);
  return {
    obtener: (clave) => elegir().obtener(clave),
    modificar: (clave, decidir, opciones) => elegir().modificar(clave, decidir, opciones),
    listar: (indice, valor) => elegir().listar(indice, valor),
  };
}
