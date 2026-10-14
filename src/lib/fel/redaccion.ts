/**
 * Redacción de datos antes de persistirlos en `fel_intentos`/auditoría o escribirlos en logs. Lista CERRADA de claves
 * sensibles a cualquier profundidad + patrones de tokens en texto libre, con truncado. Nunca se guarda el XML completo.
 */

const CLAVE_SENSIBLE = /(pass(word)?|contrase|token|secret|secreto|llave|api[-_]?key|authorization|credencial|bearer|firma|signature)/i;
const PATRONES_TEXTO: RegExp[] = [
  /(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi,
  /((?:password|passwd|token|secret|api[-_]?key|llave)\s*[=:]\s*)[^\s&;,"']+/gi,
];
export const MARCA_REDACTADO = "[REDACTADO]";
export const LIMITE_REDACCION = 2000;

function limpiarTexto(texto: string): string {
  return PATRONES_TEXTO.reduce((t, re) => t.replace(re, `$1${MARCA_REDACTADO}`), texto);
}

function redactarValor(valor: unknown, profundidad: number): unknown {
  if (profundidad > 8) return MARCA_REDACTADO;
  if (typeof valor === "string") return limpiarTexto(valor);
  if (Array.isArray(valor)) return valor.map((v) => redactarValor(v, profundidad + 1));
  if (valor && typeof valor === "object") {
    return Object.fromEntries(
      Object.entries(valor as Record<string, unknown>).map(([k, v]) => [
        k,
        CLAVE_SENSIBLE.test(k) ? MARCA_REDACTADO : redactarValor(v, profundidad + 1),
      ]),
    );
  }
  return valor;
}

/** Devuelve texto seguro y acotado (JSON si es objeto). */
export function redactar(valor: unknown, limite = LIMITE_REDACCION): string {
  const seguro = redactarValor(valor, 0);
  const texto = typeof seguro === "string" ? seguro : JSON.stringify(seguro) ?? "";
  return texto.length > limite ? `${texto.slice(0, limite)}…` : texto;
}
