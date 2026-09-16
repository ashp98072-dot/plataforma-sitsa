export type DatosPagoEmpleado = { cuentaBancaria?: string | null; telefono?: string | null };

/** Sugerencia al cambiar explícitamente empleado o método; nunca modifica RRHH. */
export function destinoPagoEmpleado(metodo: string | null | undefined, empleado?: DatosPagoEmpleado): string {
  if (metodo === "Transferencia") return empleado?.cuentaBancaria?.trim() ?? "";
  if (metodo === "Transferencia móvil") return empleado?.telefono?.trim() ?? "";
  return "";
}
