import type { MotivoFallo } from "./almacen";

/**
 * Validación del payload ANTES de tocar el almacén. El payload debe ser datos JSON puros (objetos planos, arreglos, cadenas,
 * números finitos, booleanos y null): así la estructura clonada por IndexedDB conserva números y cadenas EXACTOS y nunca se
 * guardan archivos (File/Blob), funciones ni instancias de clases. También se rechazan, como defensa en profundidad, claves
 * con nombre de credencial; NO es un detector de secretos: los adaptadores deben usar una lista blanca de campos.
 */
const PROFUNDIDAD_MAX = 20;
const CLAVE_SENSIBLE = /^(password|passwd|pwd|contrasena|contraseña|token|access_?token|refresh_?token|authorization|cookie|set-cookie|secret|client_?secret|api_?key)$/i;

export type ProblemaPayload = { motivo: MotivoFallo; mensaje: string };

function esObjetoPlano(v: object): boolean {
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function recorrer(valor: unknown, ruta: string, profundidad: number): ProblemaPayload | null {
  if (profundidad > PROFUNDIDAD_MAX) return { motivo: "payload_invalido", mensaje: `El borrador está demasiado anidado (${ruta}).` };
  if (valor === null) return null;
  switch (typeof valor) {
    case "string":
    case "boolean":
      return null;
    case "number":
      return Number.isFinite(valor) ? null : { motivo: "payload_invalido", mensaje: `Número no finito en ${ruta}.` };
    case "object":
      break;
    default:
      return { motivo: "payload_invalido", mensaje: `Tipo no permitido (${typeof valor}) en ${ruta}.` };
  }
  if (Array.isArray(valor)) {
    for (let i = 0; i < valor.length; i++) {
      const p = recorrer(valor[i], `${ruta}[${i}]`, profundidad + 1);
      if (p) return p;
    }
    return null;
  }
  if (!esObjetoPlano(valor as object)) return { motivo: "payload_invalido", mensaje: `Objeto no permitido (archivo o instancia) en ${ruta}.` };
  for (const [k, v] of Object.entries(valor as Record<string, unknown>)) {
    if (CLAVE_SENSIBLE.test(k)) return { motivo: "payload_invalido", mensaje: `El campo «${k}» no puede guardarse en un borrador.` };
    const p = recorrer(v, `${ruta}.${k}`, profundidad + 1);
    if (p) return p;
  }
  return null;
}

export function validarPayload(payload: unknown, maxChars: number): ProblemaPayload | null {
  const p = recorrer(payload, "payload", 0);
  if (p) return p;
  let largo: number;
  try {
    largo = JSON.stringify(payload).length;
  } catch {
    return { motivo: "payload_invalido", mensaje: "El borrador no se puede serializar." };
  }
  if (largo > maxChars) return { motivo: "payload_demasiado_grande", mensaje: "El borrador supera el tamaño máximo permitido." };
  return null;
}
