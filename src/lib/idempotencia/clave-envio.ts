/**
 * IDEMPOTENCIA DE ENVÍO (Operaciones) — pieza compartida por cliente y servidor.
 *
 * Una «clave de envío» identifica UN intento lógico de creación (no el contenido): el formulario la genera al primer
 * «Guardar» de un registro nuevo y la reutiliza en cada reintento de ese mismo registro (red caída, respuesta perdida,
 * subida de comprobante fallida). El servidor la persiste con UNIQUE (empresa_id, clave) y la liga a una huella del
 * contenido: misma clave + mismo contenido = misma creación; misma clave + contenido distinto = 409.
 *
 * NO es un identificador de negocio y NUNCA se deriva de monto/fecha/solicitante/proveedor/concepto: dos registros
 * legítimos iguales deben poder coexistir con claves distintas.
 */

/** UUID v4 (36) o cualquier token URL-safe de 16 a 64 caracteres. */
export const CLAVE_ENVIO_REGEX = /^[A-Za-z0-9_-]{16,64}$/;

/** Genera una clave nueva. `crypto.randomUUID` solo existe en contextos seguros; el respaldo usa `getRandomValues`. */
export function nuevaClaveEnvio(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  const bytes = new Uint8Array(16);
  c.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export type ResultadoEnvio<T> = { omitido: true } | { omitido: false; valor: T };

/**
 * Guard de envío en vuelo, independiente de React (un `useRef` lo conserva entre renders). A diferencia de un estado
 * `guardando`, la bandera se activa de forma SÍNCRONA: dos clics (o clic + Enter) en el mismo tick no pasan ambos.
 * `ejecutar` siempre libera la bandera al terminar, con éxito o con error, para que el botón pueda reintentar.
 */
export function crearGuardEnvio() {
  let enVuelo = false;
  return {
    get enVuelo() {
      return enVuelo;
    },
    async ejecutar<T>(tarea: () => Promise<T>): Promise<ResultadoEnvio<T>> {
      if (enVuelo) return { omitido: true };
      enVuelo = true;
      try {
        return { omitido: false, valor: await tarea() };
      } finally {
        enVuelo = false;
      }
    },
  };
}

export type GuardEnvio = ReturnType<typeof crearGuardEnvio>;

/**
 * Guard de envío único + clave de envío del intento lógico, en UN solo objeto estable (un `useState(() => …)` lo conserva
 * entre renders sin necesitar `useRef`). La clave se genera perezosamente al primer envío y se CONSERVA mientras el intento
 * siga incierto (red caída, timeout, 5xx, validación); solo `reiniciarClave()` la descarta (nuevo registro).
 */
export function crearEnvioUnico() {
  const guard = crearGuardEnvio();
  let clave: string | null = null;
  return {
    get enVuelo() {
      return guard.enVuelo;
    },
    ejecutar: guard.ejecutar,
    /** Clave del intento actual: la misma en cada llamada hasta `reiniciarClave()`. */
    clave(): string {
      return (clave ??= nuevaClaveEnvio());
    },
    reiniciarClave() {
      clave = null;
    },
  };
}

export type EnvioUnico = ReturnType<typeof crearEnvioUnico>;
