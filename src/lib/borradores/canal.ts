/**
 * BORR-1c — canal de difusión ENTRE PESTAÑAS (BroadcastChannel) con degradación segura.
 *
 * Es solo AVISO: nunca es la autoridad. El control definitivo ante escrituras concurrentes es la revisión atómica (compare-and-set)
 * de IndexedDB en el núcleo. Si BroadcastChannel no existe o falla, el controlador sigue funcionando (sin avisos proactivos; al
 * volver a primer plano revisa la revisión almacenada y, en cualquier caso, una revisión obsoleta nunca sobrescribe a otra).
 * No se usan cerrojos ni elección de líder: una pestaña cerrada de forma inesperada no puede dejar nada bloqueado.
 */
export type MensajeCanal = { t: string; de: string; [dato: string]: unknown };

export interface CanalLike {
  postMessage(mensaje: unknown): void;
  close(): void;
  onmessage: ((evento: { data: unknown }) => void) | null;
}
export type FabricaCanal = (nombre: string) => CanalLike;

function fabricaNativa(): FabricaCanal | null {
  try {
    if (typeof BroadcastChannel === "undefined") return null;
    return (nombre) => new BroadcastChannel(nombre) as unknown as CanalLike;
  } catch {
    return null;
  }
}

let fabrica: FabricaCanal | null | undefined;

/** Fábrica vigente: la nativa por defecto, o la inyectada (pruebas / integraciones). `null` = sin canal. */
export function obtenerFabricaCanal(): FabricaCanal | null {
  if (fabrica === undefined) fabrica = fabricaNativa();
  return fabrica;
}

/** Sustituye la fábrica (`undefined` restablece la nativa). Útil en pruebas para simular la ausencia de BroadcastChannel. */
export function establecerFabricaCanal(nueva: FabricaCanal | null | undefined): void {
  fabrica = nueva;
}

export type CanalSeguro = {
  publicar(mensaje: Omit<MensajeCanal, "de">): void;
  cerrar(): void;
};

/** Abre un canal; cualquier fallo (inexistente, bloqueado, mensaje no clonable) se traga: la coordinación solo degrada. */
export function abrirCanalSeguro(nombre: string, instancia: string, alMensaje: (m: MensajeCanal) => void, fab: FabricaCanal | null = obtenerFabricaCanal()): CanalSeguro | null {
  if (!fab) return null;
  try {
    const canal = fab(nombre);
    canal.onmessage = (evento) => {
      const d = evento?.data as MensajeCanal | undefined;
      if (!d || typeof d !== "object" || typeof d.t !== "string" || d.de === instancia) return;
      try { alMensaje(d); } catch { /* un manejador defectuoso no debe romper el canal */ }
    };
    return {
      publicar: (m) => { try { canal.postMessage({ ...m, de: instancia }); } catch { /* degradación segura */ } },
      cerrar: () => { try { canal.onmessage = null; canal.close(); } catch { /* ya cerrado */ } },
    };
  } catch {
    return null;
  }
}
