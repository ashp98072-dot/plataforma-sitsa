/**
 * Fuente única para obtener el secreto usado en los JWT de sesión (tanto
 * la sesión de staff como la del portal de colaborador comparten este
 * mismo secreto y este mismo helper).
 *
 * En producción, si AUTH_SECRET no está definido (o es demasiado corto),
 * se lanza un error en vez de usar un secreto por defecto: ese secreto
 * vive en el código fuente público del repositorio, así que si llegara a
 * usarse en producción cualquiera podría forjar sesiones válidas
 * (incluida una sesión de Admin, o una de colaborador en el portal).
 */

const DEV_FALLBACK_SECRET = "dev-insecure-secret-change-me-32";
const MIN_LENGTH = 16;

let warned = false;

export function getAuthSecretBytes(): Uint8Array {
  const secret = process.env.AUTH_SECRET;

  if (secret && secret.length >= MIN_LENGTH) {
    return new TextEncoder().encode(secret);
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "AUTH_SECRET no está configurado (o tiene menos de 16 caracteres). " +
        "Define una variable de entorno AUTH_SECRET con un valor largo y " +
        "aleatorio antes de arrancar en producción.",
    );
  }

  if (!warned) {
    warned = true;
    console.warn(
      "[auth] AUTH_SECRET no configurado: usando secreto de desarrollo " +
        "inseguro. Esto NUNCA debe pasar en producción — define AUTH_SECRET " +
        "en tu .env antes de desplegar.",
    );
  }
  return new TextEncoder().encode(DEV_FALLBACK_SECRET);
}

/** Usado por instrumentation.ts para fallar rápido al arrancar el server. */
export function verificarAuthSecretAlArrancar(): void {
  getAuthSecretBytes();
}