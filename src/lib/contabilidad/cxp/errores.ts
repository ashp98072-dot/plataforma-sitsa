/** Error de dominio de Cuentas por pagar: mensaje apto para el usuario + estado HTTP. Nunca incluye SQL ni datos de otra empresa. */
export class ErrorCxp extends Error {
  constructor(message: string, public readonly status = 400, public readonly codigo = "CXP_ERROR") {
    super(message);
    this.name = "ErrorCxp";
  }
}

export const esErrorDuplicado = (e: unknown) => (e as { code?: string; errno?: number } | null)?.code === "ER_DUP_ENTRY";
/** Conflictos transitorios del motor: se informan como 409 «reintenta», nunca como 500. */
export const esConflictoTransitorio = (e: unknown) => ["ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT"].includes((e as { code?: string } | null)?.code ?? "");
