import { TIPOS_BORRADOR, type AmbitoBorrador, type AmbitoUsuarioEmpresa } from "./tipos";

/** Longitud máxima razonable de un identificador opaco / slug (defensa contra claves absurdas). */
const MAX_ID = 200;
// Sin caracteres de control (incluye NUL y saltos de línea): evita claves ambiguas o invisibles.
const CONTROL = /[\u0000-\u001f\u007f]/;

function textoValido(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0 && v.length <= MAX_ID && !CONTROL.test(v);
}
const enteroPositivo = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;

/** `null` si el ámbito de usuario+empresa es utilizable; si no, el motivo legible. Nunca se completa con valores por defecto. */
export function problemaAmbitoUsuarioEmpresa(a: unknown): string | null {
  if (!a || typeof a !== "object") return "Falta el ámbito del borrador.";
  const { ownerKey, empresaId } = a as Partial<AmbitoUsuarioEmpresa>;
  if (!textoValido(ownerKey)) return "El identificador del propietario no es válido.";
  if (!enteroPositivo(empresaId)) return "El identificador de empresa no es válido.";
  return null;
}

export function problemaAmbito(a: unknown): string | null {
  const base = problemaAmbitoUsuarioEmpresa(a);
  if (base) return base;
  const { empresaSlug, tipo } = a as Partial<AmbitoBorrador>;
  if (!textoValido(empresaSlug)) return "El slug de empresa no es válido.";
  if (!(TIPOS_BORRADOR as readonly unknown[]).includes(tipo)) return "El tipo de formulario no es válido.";
  return null;
}

/** Clave del conjunto usuario+empresa (índice de listado/limpieza). JSON de un arreglo: inyectiva, sin colisiones por separadores. */
export const claveAmbitoUsuarioEmpresa = (a: AmbitoUsuarioEmpresa): string => JSON.stringify([a.ownerKey, a.empresaId]);

/** Clave primaria del borrador: ownerKey + empresa + tipo. Un solo registro por combinación. */
export const claveBorrador = (a: Pick<AmbitoBorrador, "ownerKey" | "empresaId" | "tipo">): string =>
  JSON.stringify([a.ownerKey, a.empresaId, a.tipo]);
