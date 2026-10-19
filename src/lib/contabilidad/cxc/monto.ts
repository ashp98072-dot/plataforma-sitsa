/**
 * Monto de un cobro tecleado por el usuario → número decimal para el backend (Q, máximo 2 decimales, > 0). PURO (seguro para componentes cliente).
 * Acepta `2000`, `2000.00`, `2,000.00`, `1,234,567.5`. La coma SOLO es separador de miles (grupos de 3 dígitos); el punto es el decimal.
 * Rechaza (devuelve null) lo ambiguo o inválido en vez de adivinar: `2,00`, `2.000,00`, `1,23`, `1.234`, `1e3`, `-5`, `0`, vacío, letras.
 * No hace aritmética financiera: el backend (`registrarPago`) valida el saldo.
 */
const FORMATO = /^(?:\d{1,12}|\d{1,3}(?:,\d{3}){1,3})(?:\.\d{1,2})?$/;

export function parsearMontoCobro(texto: string): number | null {
  const t = texto.trim();
  if (!FORMATO.test(t)) return null;
  const n = Number(t.replaceAll(",", ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}
