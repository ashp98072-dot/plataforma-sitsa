import { MSG_CARGA_RED, MSG_CARGA_TARDO } from "@/lib/tms/plazos-copia";

/**
 * Solicitudes cancelables de «Copiar programación» (cliente). Cada `iniciar()`:
 *  - cancela la solicitud anterior del mismo gestor (una respuesta vieja NUNCA sobrescribe a una nueva),
 *  - arma un `AbortController` con un temporizador de plazo (la pantalla jamás queda indefinidamente en «Cargando…»),
 *  - expone `esVigente()` para descartar respuestas que llegan tarde.
 * Lógica pura (sin React ni DOM) para poder probarla con temporizadores simulados.
 */
export type Solicitud = {
  readonly id: number;
  readonly signal: AbortSignal;
  /** true mientras sea la solicitud más reciente del gestor y no haya sido cancelada ni vencida. */
  esVigente: () => boolean;
  /** true si fue cancelada por el PLAZO (no por reemplazo ni por desmontaje). */
  vencio: () => boolean;
  /** Libera el temporizador (llamar siempre al terminar, con éxito o error). */
  terminar: () => void;
};

export type GestorSolicitudes = {
  iniciar: () => Solicitud;
  /** Cancela la solicitud en curso (p. ej. al desmontar la pantalla). */
  cancelar: () => void;
};

export function crearGestorSolicitudes(plazoMs: number): GestorSolicitudes {
  let secuencia = 0;
  let actual: { id: number; ctl: AbortController; vencio: boolean; timer: ReturnType<typeof setTimeout> | undefined } | null = null;

  const liberar = (s: NonNullable<typeof actual>) => { if (s.timer !== undefined) { clearTimeout(s.timer); s.timer = undefined; } };

  return {
    iniciar() {
      if (actual) { liberar(actual); actual.ctl.abort(); }   // reemplazo: la anterior se cancela y su respuesta se descarta
      const s = { id: ++secuencia, ctl: new AbortController(), vencio: false, timer: undefined as ReturnType<typeof setTimeout> | undefined };
      s.timer = setTimeout(() => { s.vencio = true; s.timer = undefined; s.ctl.abort(); }, plazoMs);
      actual = s;
      return {
        id: s.id,
        signal: s.ctl.signal,
        esVigente: () => actual?.id === s.id && !s.ctl.signal.aborted,
        vencio: () => s.vencio,
        terminar: () => liberar(s),
      };
    },
    cancelar() { if (actual) { liberar(actual); actual.ctl.abort(); actual = null; } },
  };
}

export type FalloSolicitud = { ignorar: true } | { ignorar: false; mensaje: string; reintentable: boolean };

/** Clasifica un fallo de `fetch`: plazo vencido (mensaje claro + reintentar), cancelación por reemplazo/desmontaje (se ignora) o error de red (reintentar). */
export function clasificarFalloSolicitud(e: unknown, s: Solicitud): FalloSolicitud {
  if (s.vencio()) return { ignorar: false, mensaje: MSG_CARGA_TARDO, reintentable: true };
  const abortada = (e as { name?: string } | null)?.name === "AbortError" || s.signal.aborted;
  if (abortada) return { ignorar: true };
  return { ignorar: false, mensaje: MSG_CARGA_RED, reintentable: true };
}

/** Un 503 (plazo/bloqueo del servidor) y los 5xx se pueden reintentar; un 4xx (datos/permisos) no. */
export const esRespuestaReintentable = (status: number) => status === 503 || status === 502 || status === 504 || status >= 500;
