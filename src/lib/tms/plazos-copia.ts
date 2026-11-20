/**
 * Plazos de «Copiar programación» (vista previa y revalidación). Constantes puras: las usan las rutas (servidor) y la pantalla (cliente).
 * El plazo del CLIENTE es mayor que el del SERVIDOR a propósito: normalmente el servidor responde primero con su mensaje controlado (503); el
 * temporizador del cliente es la red de seguridad si la respuesta nunca llega (proxy, red, proceso colgado).
 */
export const PLAZO_SERVIDOR_COPIAR_MS = 30_000;
export const LIMITE_SENTENCIA_COPIAR_MS = 10_000;
export const PLAZO_CLIENTE_COPIAR_MS = 40_000;

export const MSG_CARGA_TARDO = "La carga tardó demasiado y se canceló. Puedes reintentar.";
export const MSG_CARGA_RED = "No se pudo conectar con el servidor. Puedes reintentar.";
