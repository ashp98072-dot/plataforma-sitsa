export function codigoAutomaticoCliente(id: number): string {
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("ID de cliente inválido para generar código.");
  }
  return `CLI-${String(id).padStart(6, "0")}`;
}
