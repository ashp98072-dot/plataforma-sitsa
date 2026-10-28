/** Clasificación pura: no interpreta mensajes ni expone SQL/valores del driver. */
export class ErrorCalendario extends Error {
  constructor(message: string, public status = 409) { super(message); }
}
export function clasificarErrorCalendario(error: unknown) {
  const e = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const code = typeof e.code === "string" ? e.code : undefined;
  const errno = typeof e.errno === "number" ? e.errno : undefined;
  const sqlState = typeof e.sqlState === "string" ? e.sqlState : undefined;
  const coincide = (c: string, n: number) => (code === c && (errno === undefined || errno === n)) || (code === undefined && errno === n);
  const tipo = error instanceof ErrorCalendario ? (error.status === 409 ? "funcional" : "servicio")
    : coincide("ER_DUP_ENTRY", 1062) ? "unique"
    : coincide("ER_LOCK_DEADLOCK", 1213) ? "deadlock"
    : coincide("ER_LOCK_WAIT_TIMEOUT", 1205) ? "timeout"
    : coincide("ER_CHECKREAD", 1020) ? "registro_cambiado"
    : coincide("ER_INTERNAL_ERROR", 1815) || coincide("ER_GET_ERRNO", 1030) || coincide("HA_ERR_RECORD_CHANGED", 123) ? "motor_interno"
    : "inesperado";
  return { tipo, code, errno, sqlState, statusServicio: error instanceof ErrorCalendario ? error.status : undefined };
}
