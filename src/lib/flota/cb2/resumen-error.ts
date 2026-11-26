// Solo códigos conocidos: no registrar texto, sentencias ni valores arbitrarios de errores.
const codigos = new Set(["ER_BAD_FIELD_ERROR", "ER_NO_SUCH_TABLE", "ER_LOCK_WAIT_TIMEOUT", "ER_LOCK_DEADLOCK", "ER_QUERY_INTERRUPTED", "ER_QUERY_TIMEOUT", "PROTOCOL_CONNECTION_LOST", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT"]);
export function codigoSeguroResumen(error: unknown): string {
  const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : "";
  return codigos.has(code) ? code : "DESCONOCIDO";
}
