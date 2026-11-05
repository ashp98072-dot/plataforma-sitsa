export type BancoContable = {
  id: number; banco: string | null; alias: string | null; moneda: string | null; activa: boolean | null;
  cuenta: { codigo: string | null; nombre: string | null; activa: boolean | null } | null;
  advertencias: string[];
};
/** Defensa adicional para referencias copiadas accidentalmente en textos de presentación. */
export function textoBanco(v: unknown): string | null {
  if (typeof v !== "string" || !v.trim()) return null;
  return v.trim().replace(/\d(?:[\s.-]*\d){6,}/g, "[dato bancario omitido]");
}
