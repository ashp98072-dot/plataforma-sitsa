/**
 * Chasis (VIN) de una ficha de Flota. Es el dato que, junto con la placa comparable y el tipo, acredita que dos fichas son la MISMA unidad física:
 * la misma regla que aplican `verificarIdentidad` (identidad-fisica.ts) y el disparador `fifi_nueva` (6–32 caracteres alfanuméricos, no repetido,
 * ni un marcador de «sin dato»). Aquí se usa para REGISTRARLO en una ficha existente con auditoría (antes solo se podía en el alta o por Excel).
 */
export const MARCADORES_SIN_DATO = ["DESCONOCIDO", "PENDIENTE", "SINDATO", "NOAPLICA"];

/** Forma comparable: sin espacios y en mayúsculas (igual que la identidad física). */
export const serialChasis = (v: unknown) => String(v ?? "").trim().toUpperCase().replace(/\s/g, "");

/** ¿Es un chasis real que puede acreditar identidad? */
export const chasisAcreditable = (v: unknown) => {
  const s = serialChasis(v);
  return /^[A-Z0-9]{6,32}$/.test(s) && !/^(.)\1+$/.test(s) && !MARCADORES_SIN_DATO.includes(s);
};

export type ResultadoChasis = { ok: true; valor: string } | { ok: false; error: string };

/** Valida un chasis a REGISTRAR: debe ser real (no se guardan marcadores ni valores repetidos); se guarda en su forma comparable. */
export function validarChasisParaRegistro(v: unknown): ResultadoChasis {
  const s = serialChasis(v);
  if (!s) return { ok: false, error: "Indica el número de chasis tal como figura en la tarjeta de circulación." };
  if (!chasisAcreditable(s)) return { ok: false, error: "Chasis no válido: use 6 a 32 letras o números reales, sin repetir un mismo carácter ni marcadores como «desconocido»." };
  return { ok: true, valor: s };
}
