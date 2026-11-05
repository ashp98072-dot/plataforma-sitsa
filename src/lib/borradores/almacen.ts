import type { RegistroAlmacenado } from "./tipos";

/**
 * BORR-1c — MARCA DE PURGA por propietario: registro con su propia clave (`["__purga__", ownerKey]`, distinta de toda clave de borrador)
 * y SIN los campos indexados (`ownerKey`, `ambitoClave`), así que ningún listado la ve. `purgas` es la ÉPOCA: crece de forma estricta
 * con cada purga. Una escritura de una sesión anterior (época menor) es rechazada DENTRO de su transacción.
 */
export type RegistroMarcaPurga = { clave: string; tipo: "marca_purga"; formato: number; usuario: string; purgas: number; purgadoEn: number };

/**
 * Interfaz de almacenamiento SUSTITUIBLE (IndexedDB en producción; cualquier doble en pruebas). Opera sobre registros
 * crudos (`unknown`): validar la forma de lo leído es responsabilidad del núcleo, no del almacén.
 */

export type MotivoFallo =
  | "no_disponible" // IndexedDB inexistente, bloqueado (modo privado, política) o no se pudo abrir
  | "persistencia_desactivada" // el usuario/equipo desactivó la persistencia local
  | "cuota_excedida"
  | "escritura_fallida" // la transacción de escritura no se confirmó
  | "lectura_fallida"
  | "datos_corruptos" // el registro existe pero no tiene la forma esperada (NO se borra ni se sobrescribe)
  | "version_incompatible" // registro de una versión futura: se conserva intacto
  | "revision_obsoleta" // otra escritura se adelantó; hay que releer antes de guardar
  | "purga_posterior" // el usuario eligió eliminar sus borradores (cierre de sesión) DESPUÉS de empezar la sesión de quien escribe
  | "ambito_invalido"
  | "payload_invalido"
  | "payload_demasiado_grande"
  | "argumento_invalido";

export type Fallo = { ok: false; motivo: MotivoFallo; mensaje: string; revisionActual?: number };
export type Exito<T> = { ok: true; valor: T };
export type Resultado<T> = Exito<T> | Fallo;

export const exito = <T>(valor: T): Exito<T> => ({ ok: true, valor });
export const fallo = (motivo: MotivoFallo, mensaje: string, extra: { revisionActual?: number } = {}): Fallo => ({ ok: false, motivo, mensaje, ...extra });

/** Decisión de una modificación atómica: se evalúa sobre el valor actual DENTRO de la misma transacción de escritura. */
export type Decision<R> =
  | { accion: "escribir"; registro: RegistroAlmacenado | RegistroMarcaPurga; resultado: R }
  | { accion: "eliminar"; resultado: R }
  | { accion: "ninguna"; resultado: R };

export interface AlmacenBorradores {
  /** Lectura de un registro por clave. `undefined` = no existe. */
  obtener(clave: string): Promise<Resultado<unknown | undefined>>;
  /**
   * Lee y decide en UNA transacción de lectura/escritura (compare-and-set). `decidir` es síncrona. Solo devuelve éxito
   * cuando la transacción se CONFIRMÓ; si `decidir` lanza, la transacción se aborta y no queda nada escrito.
   */
  modificar<R>(
    clave: string,
    decidir: (actual: unknown | undefined, adicionales: (unknown | undefined)[]) => Decision<R>,
    opciones?: {
      /**
       * BORR-1c — claves cuyo valor se lee en LA MISMA transacción y se entrega a `decidir` (en el mismo orden). Permite verificar la
       * marca de purga de forma atómica junto con la escritura del borrador.
       */
      tambienLeer?: readonly string[];
    },
  ): Promise<Resultado<R>>;
  /** Registros crudos por índice: `ownerKey` (todas las empresas del usuario) o `ambito` (usuario+empresa). */
  listar(indice: "ownerKey" | "ambito", valor: string): Promise<Resultado<unknown[]>>;
}

/** Almacén para «no guardar en este equipo»: toda operación falla de forma explícita y nada se persiste. */
export function crearAlmacenDesactivado(): AlmacenBorradores {
  const f = () => fallo("persistencia_desactivada", "El guardado de borradores en este equipo está desactivado.");
  return { obtener: async () => f(), modificar: async () => f(), listar: async () => f() };
}
