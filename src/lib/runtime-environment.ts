/** Edge-safe selector: NODE_ENV continues to describe the Next runtime only. */
export function isSandbox(): boolean {
  const mode = process.env.NOVALVION_ENV;
  if (mode !== undefined && mode !== "production" && mode !== "sandbox") {
    throw new Error("NOVALVION_ENV inválido.");
  }
  if (mode !== "sandbox" && (process.env.SANDBOX_ROOT || process.env.SANDBOX_ID)) {
    throw new Error("Configuración de entorno contradictoria.");
  }
  return mode === "sandbox";
}
