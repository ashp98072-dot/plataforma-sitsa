import type { MotivoFallo } from "./almacen";

/**
 * Validación del payload ANTES de tocar el almacén y al LEER un registro recuperado. El payload debe ser datos JSON puros
 * (objetos planos, arreglos densos, cadenas, números finitos, booleanos y null): así la estructura clonada por IndexedDB
 * conserva números y cadenas EXACTOS y nunca se guardan archivos (File/Blob), funciones ni instancias de clases. También se
 * rechazan, como defensa en profundidad, claves con nombre de credencial; NO es un detector de secretos: los adaptadores
 * deben usar una lista blanca de campos.
 *
 * DEFENSIVO: la inspección no ejecuta getters (se rechazan las propiedades calculadas) y cualquier excepción al inspeccionar
 * (proxy problemático, proxy revocado, objeto exótico) se convierte en `payload_invalido`; estas funciones NUNCA lanzan. El
 * mensaje es fijo: no incluye el texto de la excepción ni valores del payload.
 */
const PROFUNDIDAD_MAX = 20;
const CLAVE_SENSIBLE = /^(password|passwd|pwd|contrasena|contraseña|token|access_?token|refresh_?token|authorization|cookie|set-cookie|secret|client_?secret|api_?key)$/i;

export type ProblemaPayload = { motivo: MotivoFallo; mensaje: string };

const invalido = (mensaje: string): ProblemaPayload => ({ motivo: "payload_invalido", mensaje });

function esObjetoPlano(v: object): boolean {
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/** Puede LANZAR (proxies, objetos exóticos): solo se llama desde `inspeccionar`, que lo captura. */
function recorrer(valor: unknown, ruta: string, profundidad: number): ProblemaPayload | null {
  if (profundidad > PROFUNDIDAD_MAX) return invalido(`El borrador está demasiado anidado (${ruta}).`);
  if (valor === null) return null;
  switch (typeof valor) {
    case "string":
    case "boolean":
      return null;
    case "number":
      return Number.isFinite(valor) ? null : invalido(`Número no finito en ${ruta}.`);
    case "object":
      break;
    default:
      return invalido(`Tipo no permitido (${typeof valor}) en ${ruta}.`);
  }
  if (Array.isArray(valor)) {
    const largo = valor.length;
    for (let i = 0; i < largo; i++) {
      const d = Reflect.getOwnPropertyDescriptor(valor, String(i));
      if (!d) return invalido(`Arreglo con huecos en ${ruta}[${i}].`);
      if (d.get || d.set) return invalido(`Propiedad calculada no permitida en ${ruta}[${i}].`);
      const p = recorrer(d.value, `${ruta}[${i}]`, profundidad + 1);
      if (p) return p;
    }
    return null;
  }
  if (!esObjetoPlano(valor as object)) return invalido(`Objeto no permitido (archivo o instancia) en ${ruta}.`);
  for (const k of Reflect.ownKeys(valor as object)) {
    if (typeof k === "symbol") continue; // el clonado estructurado los ignora
    const d = Reflect.getOwnPropertyDescriptor(valor as object, k);
    if (!d || !d.enumerable) continue;
    if (CLAVE_SENSIBLE.test(k)) return invalido(`El campo «${k}» no puede guardarse en un borrador.`);
    if (d.get || d.set) return invalido(`Propiedad calculada no permitida en ${ruta}.${k}.`);
    const p = recorrer(d.value, `${ruta}.${k}`, profundidad + 1);
    if (p) return p;
  }
  return null;
}

function inspeccionar(payload: unknown): ProblemaPayload | null {
  try {
    return recorrer(payload, "payload", 0);
  } catch {
    return invalido("No se pudo inspeccionar el borrador: contiene propiedades no legibles.");
  }
}

/** Solo estructura (sin tope de tamaño): para validar lo LEÍDO del almacén sin depender de la configuración actual. */
export function validarEstructuraPayload(payload: unknown): ProblemaPayload | null {
  return inspeccionar(payload);
}

export function validarPayload(payload: unknown, maxChars: number): ProblemaPayload | null {
  const p = inspeccionar(payload);
  if (p) return p;
  let largo: number;
  try {
    largo = JSON.stringify(payload).length;
  } catch {
    return invalido("El borrador no se puede serializar.");
  }
  if (largo > maxChars) return { motivo: "payload_demasiado_grande", mensaje: "El borrador supera el tamaño máximo permitido." };
  return null;
}
