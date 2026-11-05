import { CLAVE_ENVIO_REGEX, nuevaClaveEnvio } from "@/lib/idempotencia/clave-envio";

/**
 * BORR-1e — contrato de ENVÍO de «Nueva solicitud de fondo» con el borrador local. Reutiliza el puente genérico de BORR-1d
 * (`@/lib/compras/requerimiento-borrador-envio`); aquí solo vive lo propio de Fondos: el adaptador de la clave (`claveEnvioRef`) y la
 * clasificación de respuestas según el contrato REAL de `POST /tms/fondos`.
 *
 * Contrato del backend (route.ts + respuestaDeExcepcion): validación Zod/dominio → 400 con el INSERT revertido; 401/403/404 antes de
 * crear; 409 = ConflictoIdempotencia (la clave YA existe con otro contenido: una creación anterior pudo confirmarse); 500 = fallo
 * inesperado (el resultado es DESCONOCIDO); 2xx = creada (devuelve `solicitud.id`; con misma clave + mismo contenido, la original).
 */
export type ResultadoEnvioFondo = "exito" | "rechazo_definitivo" | "incierto";

const DEFINITIVOS = new Set([400, 401, 403, 404]);

export function clasificarResultadoEnvioFondo(r: { lanzo: boolean; ok?: boolean; status?: number; id?: unknown }): ResultadoEnvioFondo {
  if (r.lanzo) return "incierto";
  if (r.ok) return typeof r.id === "number" && Number.isSafeInteger(r.id) && r.id > 0 ? "exito" : "incierto";
  // Solo los códigos con garantía de «nada se creó» liberan el intento. 409 (conflicto de idempotencia), 5xx, 408/425/429 y cualquier
  // otro código fuera del contrato conocido se tratan como INCIERTOS: la clave y el contenido se conservan.
  return DEFINITIVOS.has(r.status ?? 0) ? "rechazo_definitivo" : "incierto";
}

/** Adaptador de `claveEnvioRef` (la clave del intento vive en un ref de la página) a la interfaz del puente. */
export function envioDesdeRef(ref: { current: string | null }) {
  return {
    clave: () => (ref.current ??= nuevaClaveEnvio()),
    adoptarClave: (c: string) => {
      if (typeof c !== "string" || !CLAVE_ENVIO_REGEX.test(c)) return false;
      ref.current = c;
      return true;
    },
  };
}
