import type { ZodError, ZodIssue } from "zod";

/**
 * ERRORES DE VALIDACIÓN CLAROS Y POR LÍNEA — convierte errores de validación (Zod u otros) en errores de formulario que un
 * usuario puede entender y corregir: número de línea, nombre del campo tal como lo ve en pantalla y el problema exacto.
 *
 * Formato (aditivo; `error` sigue existiendo para los consumidores que solo leen json.error):
 *   { error: "Hay datos que debes corregir.", errores: [{ campo, etiqueta, mensaje, linea?, coleccion? }] }
 *
 * Este módulo NO conoce ningún formulario: cada módulo aporta su `ConfigErrores` (etiquetas, nombre de las colecciones
 * repetibles y mensajes propios). Nunca expone el valor rechazado, el nombre técnico de una propiedad ni el texto crudo de Zod.
 */
export const MENSAJE_VALIDACION = "Hay datos que debes corregir.";
export const MENSAJE_ERROR_SERVIDOR = "No se pudo completar la operación. Intenta nuevamente.";
/** Con muchos errores se muestran los primeros y el resto se resume ("+ N errores adicionales."). */
export const MAX_ERRORES_VISIBLES = 12;

export type ErrorFormulario = {
  /** Ruta técnica del campo (p. ej. "lineas.1.monto"): sirve para marcar el input exacto; NO se muestra al usuario. */
  campo: string;
  /** Nombre del campo tal como aparece en pantalla (p. ej. "Monto"). */
  etiqueta: string;
  /** Problema exacto en lenguaje humano (p. ej. "debe ser mayor que Q0."). */
  mensaje: string;
  /** Número de fila/línea 1-based cuando el error pertenece a una colección repetible. */
  linea?: number;
  /** Palabra que usa la pantalla para esa colección ("Línea", "Parada", "Auxiliar"…). */
  coleccion?: string;
};

export type MensajesCampo = {
  /** Falta el dato (undefined/null/vacío). */
  requerido?: string;
  /** Enum / opción fuera de catálogo. */
  opcion?: string;
  /** Formato (regex) incorrecto. */
  formato?: string;
  /** Número que debe ser > 0 (o texto equivalente). */
  positivo?: string;
  /** Tipo de dato equivocado (no vacío): texto propio en lugar de «debe ser un número». */
  invalido?: string;
};

export type ConfigErrores = {
  /** Clave de campo -> etiqueta visible. Clave = ruta sin índices ("lineas.monto") o solo el último segmento ("monto"). */
  etiquetas: Record<string, string>;
  /** Colección repetible -> palabra que usa la pantalla para una fila ("lineas": "Línea"). */
  colecciones?: Record<string, string>;
  /** Mensajes propios de un campo (misma clave que `etiquetas`). */
  mensajes?: Record<string, MensajesCampo>;
  /** Campos de dinero: "mayor que Q0" en lugar de "mayor que 0". */
  moneda?: string[];
  /**
   * Mensajes que ya vienen escritos en el schema pero son técnicos o ambiguos (p. ej. «…compatible con DECIMAL(12,2)», «Fecha no
   * válida.»): texto exacto del schema -> texto para el usuario (sin etiqueta; se antepone la del campo).
   */
  traducciones?: Record<string, string>;
};

/* ------------------------------------------------------------------ utilidades */

function leerEnPath(payload: unknown, path: PropertyKey[]): unknown {
  let actual: unknown = payload;
  for (const segmento of path) {
    if (actual == null || typeof actual !== "object") return undefined;
    actual = (actual as Record<PropertyKey, unknown>)[segmento];
  }
  return actual;
}

const esVacio = (v: unknown) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");

/** Mensajes por defecto de Zod ("Invalid input…", "Too small…"): nunca se muestran tal cual. */
const MENSAJE_CRUDO = /^(Invalid |Too small|Too big|Unrecognized|Expected |Required|String must|Number must|Array must)/;

function humanizar(clave: string): string {
  const texto = clave.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").trim().toLowerCase();
  return texto ? texto.charAt(0).toUpperCase() + texto.slice(1) : "Dato";
}

const minuscula = (t: string) => (t ? t.charAt(0).toLowerCase() + t.slice(1) : t);
const numero = (n: number) => (Number.isInteger(n) ? n.toLocaleString("es-GT").replace(/\s/g, ",") : String(n));

/** Quita acentos y pasa a minúsculas, para comparar si un mensaje ya nombra al campo. */
const plano = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/* ------------------------------------------------------------------ Zod -> errores */

type Ruta = { campo: string; claves: string[]; hoja?: string; coleccion?: string; linea?: number; esElementoSimple: boolean };

/** "lineas",1,"monto" -> colección "lineas", línea 2, hoja "monto". */
function analizarRuta(path: PropertyKey[]): Ruta {
  const partes = path.map(String);
  const campo = partes.join(".");
  const idx = path.findIndex((s) => typeof s === "number");
  if (idx <= 0) {
    const hoja = partes.length ? partes[partes.length - 1] : undefined;
    return { campo, claves: partes, hoja, esElementoSimple: false };
  }
  const coleccion = partes[idx - 1];
  const linea = Number(path[idx]) + 1;
  const resto = partes.slice(idx + 1).filter((p) => !/^\d+$/.test(p));
  const hoja = resto.length ? resto[resto.length - 1] : undefined;
  const sinIndices = partes.filter((p) => !/^\d+$/.test(p));
  return { campo, claves: sinIndices, hoja, coleccion, linea, esElementoSimple: resto.length === 0 };
}

function buscar<T>(mapa: Record<string, T> | undefined, ruta: Ruta): T | undefined {
  if (!mapa) return undefined;
  const completa = ruta.claves.join(".");
  if (mapa[completa] !== undefined) return mapa[completa];
  if (ruta.hoja && mapa[ruta.hoja] !== undefined) return mapa[ruta.hoja];
  return undefined;
}

function esFecha(ruta: Ruta) { return /fecha/i.test(ruta.hoja ?? ""); }
function esHora(ruta: Ruta) { return /hora/i.test(ruta.hoja ?? ""); }

function traducirIssue(issue: ZodIssue, ruta: Ruta, cfg: ConfigErrores, payload: unknown): string {
  const propios = buscar(cfg.mensajes, ruta);
  const crudo = MENSAJE_CRUDO.test(issue.message);
  const valor = payload === undefined ? undefined : leerEnPath(payload, issue.path);
  const faltante = payload !== undefined ? esVacio(valor) : /received (undefined|null)\b/.test(issue.message);
  const esMoneda = Boolean(ruta.hoja && cfg.moneda?.includes(ruta.hoja));
  const sinCero = esMoneda ? "Q0" : "0";
  const anyIssue = issue as unknown as Record<string, unknown>;

  // Mensaje del schema con traducción propia del módulo (técnico o ambiguo): se reemplaza.
  const traducido = cfg.traducciones?.[issue.message];
  if (traducido !== undefined) return faltante && propios?.requerido ? propios.requerido : traducido;
  // Mensaje escrito en el propio schema (ya en español): se respeta.
  if (!crudo && issue.code !== "unrecognized_keys") return issue.message;

  switch (issue.code) {
    case "invalid_type": {
      if (faltante) return propios?.requerido ?? "es obligatorio.";
      if (propios?.invalido) return propios.invalido;
      const esperado = String(anyIssue.expected ?? "");
      if (esperado === "number" || esperado === "int") return "debe ser un número.";
      if (esperado === "string") return "no es un texto válido.";
      if (esperado === "boolean") return "no es un valor válido.";
      return "no tiene un formato válido.";
    }
    case "too_small": {
      const origen = String(anyIssue.origin ?? "");
      const minimo = Number(anyIssue.minimum);
      const inclusivo = anyIssue.inclusive !== false;
      if (origen === "number" || origen === "int" || origen === "bigint") {
        if (!inclusivo && minimo === 0) return propios?.positivo ?? `debe ser mayor que ${sinCero}.`;
        if (inclusivo && minimo === 0) return `no puede ser menor que ${sinCero}.`;
        return `debe ser ${inclusivo ? "al menos" : "mayor que"} ${esMoneda ? "Q" : ""}${numero(minimo)}.`;
      }
      if (origen === "array") return minimo <= 1 ? (propios?.requerido ?? "agrega al menos un elemento.") : `agrega al menos ${numero(minimo)} elementos.`;
      return minimo <= 1 ? (propios?.requerido ?? "es obligatorio.") : `debe tener al menos ${numero(minimo)} caracteres.`;
    }
    case "too_big": {
      const origen = String(anyIssue.origin ?? "");
      const maximo = Number(anyIssue.maximum);
      if (origen === "number" || origen === "int" || origen === "bigint") return `no puede ser mayor que ${esMoneda ? "Q" : ""}${numero(maximo)}.`;
      if (origen === "array") return `no puede tener más de ${numero(maximo)} elementos.`;
      return `no puede superar ${numero(maximo)} caracteres.`;
    }
    case "invalid_format": {
      if (propios?.formato) return propios.formato;
      const formato = String(anyIssue.format ?? "");
      if (formato === "email") return "usa un correo electrónico válido.";
      if (esFecha(ruta)) return "usa una fecha válida.";
      if (esHora(ruta)) return "usa una hora válida (HH:MM).";
      return "no tiene un formato válido.";
    }
    case "invalid_value":
      return faltante && propios?.requerido ? propios.requerido : (propios?.opcion ?? "selecciona una opción válida.");
    case "unrecognized_keys":
      return "El formulario contiene datos que no se pueden procesar.";
    default:
      return propios?.formato ?? "tiene un valor no válido.";
  }
}

/** ZodError -> errores legibles, sin duplicados equivalentes. `payload` (opcional) permite distinguir "vacío" de "mal formado". */
export function erroresDeZod(error: ZodError, cfg: ConfigErrores, payload?: unknown): ErrorFormulario[] {
  const salida: ErrorFormulario[] = [];
  const vistos = new Set<string>();
  for (const issue of error.issues) {
    const ruta = analizarRuta(issue.path);
    const coleccionNombre = ruta.coleccion ? (cfg.colecciones?.[ruta.coleccion] ?? humanizar(ruta.coleccion)) : undefined;
    let etiqueta: string;
    if (issue.code === "unrecognized_keys") etiqueta = "Formulario";
    else if (ruta.hoja === undefined && ruta.coleccion === undefined && ruta.claves.length === 0) etiqueta = "Formulario";
    else if (ruta.esElementoSimple) etiqueta = buscar(cfg.etiquetas, ruta) ?? coleccionNombre ?? humanizar(ruta.hoja ?? "");
    else etiqueta = buscar(cfg.etiquetas, ruta) ?? humanizar(ruta.hoja ?? "");
    const mensaje = traducirIssue(issue, ruta, cfg, payload);
    const item: ErrorFormulario = { campo: ruta.campo || "formulario", etiqueta, mensaje };
    if (ruta.linea !== undefined) { item.linea = ruta.linea; item.coleccion = coleccionNombre; }
    const clave = `${item.campo}|${item.mensaje}`;
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    salida.push(item);
  }
  return salida;
}

/* ------------------------------------------------------------------ presentación */

/** "Línea 2 — Monto: debe ser mayor que Q0." / "Fecha de requerimiento: es obligatorio." / "Auxiliar 3: empleado inválido." */
export function textoError(e: ErrorFormulario): string {
  const mensaje = e.mensaje.trim();
  const prefijo = e.linea !== undefined ? `${e.coleccion ?? "Línea"} ${e.linea}` : "";
  const empiezaMayuscula = /^[A-ZÁÉÍÓÚÑ¿¡]/.test(mensaje);
  // Mensaje escrito para el usuario que ya nombra al campo ("El empleado indicado no pertenece…"): no repetir la etiqueta.
  const planoMensaje = plano(mensaje);
  const yaNombra = empiezaMayuscula && plano(e.etiqueta).split(/[^a-z0-9]+/).some((palabra) => palabra.length >= 4 && planoMensaje.includes(palabra.slice(0, palabra.length - 1)));
  // Elemento simple de una colección (ruta "coleccion.N"): no hay campo propio que nombrar.
  const elementoSimple = e.linea !== undefined && e.campo.split(".").length <= 2;
  let texto: string;
  if (yaNombra) texto = prefijo ? `${prefijo} — ${mensaje}` : mensaje;
  else if (elementoSimple) texto = `${prefijo}: ${empiezaMayuscula ? mensaje : minuscula(mensaje)}`;
  else texto = `${prefijo ? `${prefijo} — ` : ""}${e.etiqueta}: ${empiezaMayuscula ? mensaje : minuscula(mensaje)}`;
  return /[.!?]$/.test(texto) ? texto : `${texto}.`;
}

/** Textos listos para mostrar; con más de `max` se resumen ("+ N errores adicionales."). */
export function resumirErrores(errores: ErrorFormulario[], max = MAX_ERRORES_VISIBLES): string[] {
  const textos = errores.map(textoError);
  if (textos.length <= max) return textos;
  const resto = textos.length - max;
  return [...textos.slice(0, max), `+ ${resto} ${resto === 1 ? "error adicional" : "errores adicionales"}.`];
}

/* ------------------------------------------------------------------ respuesta HTTP */

export type CuerpoErrores = { error: string; errores: ErrorFormulario[] };

export function cuerpoErrores(errores: ErrorFormulario[], mensaje = MENSAJE_VALIDACION): CuerpoErrores {
  return { error: mensaje, errores };
}

/** Error de validación lanzable desde la lógica de negocio (con fila/campo cuando se conoce). Se traduce a 400 con `errores`. */
export class ErrorValidacionFormulario extends Error {
  readonly errores: ErrorFormulario[];
  constructor(errores: ErrorFormulario[]) {
    super(errores.length === 1 ? textoError(errores[0]) : MENSAJE_VALIDACION);
    this.name = "ErrorValidacionFormulario";
    this.errores = errores;
  }
}

/** Estados HTTP que un error de dominio puede declarar (nunca 5xx: esos son errores inesperados). */
export type EstadoDominio = 400 | 403 | 404 | 409;

/**
 * Error de DOMINIO esperado y seguro de mostrar: el mensaje está escrito para el usuario y el estado HTTP lo declara quien lo lanza.
 * Es la ÚNICA forma de que un mensaje de excepción llegue al usuario: cualquier otro Error (bug, SQL, red, archivos…) responde un
 * 500 genérico sin su mensaje. Se lanza de forma explícita (`throw new ErrorDominioFormulario("…")`), nunca se infiere.
 */
export class ErrorDominioFormulario extends Error {
  readonly status: EstadoDominio;
  constructor(message: string, status: EstadoDominio = 400) {
    super(message);
    this.name = "ErrorDominioFormulario";
    this.status = status;
  }
}

export type RespuestaFallo = { status: EstadoDominio | 500; cuerpo: CuerpoErrores | { error: string } };

/**
 * Traduce una excepción de la lógica de negocio a la respuesta HTTP. Clasificación EXPLÍCITA, sin heurísticas:
 *  - ErrorValidacionFormulario -> 400 + errores estructurados (fila/campo);
 *  - ErrorDominioFormulario (o subclase, p. ej. ErrorGasto) -> su status + su mensaje;
 *  - CUALQUIER otro valor (Error normal, error de MySQL, string, objeto…) -> 500 + mensaje genérico, sin exponer el interno.
 */
export function respuestaDeExcepcion(e: unknown): RespuestaFallo {
  if (e instanceof ErrorValidacionFormulario) return { status: 400, cuerpo: cuerpoErrores(e.errores) };
  if (e instanceof ErrorDominioFormulario) return { status: e.status, cuerpo: { error: e.message } };
  return { status: 500, cuerpo: { error: MENSAJE_ERROR_SERVIDOR } };
}

/** Campo de dominio inferido del texto de un error de negocio (para señalar la línea y el campo). */
export type CampoDominio = { patron: RegExp; campo: string; etiqueta: string };

/**
 * Envuelve un error de dominio de UNA fila (estado 400) para que indique la línea (y el campo, si el mensaje lo permite).
 * Todo lo demás pasa sin cambios: errores inesperados (seguirán siendo 500), errores ya estructurados y errores de dominio con otro
 * estado (403/404/409), cuyo estado no debe degradarse a 400.
 */
export function conLinea(e: unknown, linea: number, coleccionKey: string, coleccion: string, campos: CampoDominio[] = []): unknown {
  if (!(e instanceof ErrorDominioFormulario) || e.status !== 400) return e;
  const hallado = campos.find((c) => c.patron.test(e.message));
  const campo = hallado?.campo ?? "linea";
  return new ErrorValidacionFormulario([
    { campo: `${coleccionKey}.${linea - 1}.${campo}`, etiqueta: hallado?.etiqueta ?? coleccion, mensaje: e.message, linea, coleccion },
  ]);
}

/* ------------------------------------------------------------------ consumo en el cliente */

export type ErroresLeidos = { mensaje: string; errores: ErrorFormulario[] };

/** Interpreta el JSON de una respuesta de error: prefiere `errores` y usa `error` como respaldo. */
export function leerErroresRespuesta(data: unknown, fallback: string): ErroresLeidos {
  const d = (data && typeof data === "object" ? data : {}) as { error?: unknown; errores?: unknown };
  const errores = Array.isArray(d.errores)
    ? (d.errores as unknown[]).filter((e): e is ErrorFormulario => !!e && typeof e === "object" && typeof (e as ErrorFormulario).mensaje === "string" && typeof (e as ErrorFormulario).etiqueta === "string")
    : [];
  const mensaje = typeof d.error === "string" && d.error.trim() ? d.error : fallback;
  return { mensaje, errores };
}

/** Mensaje de la primera falla de un campo concreto (para marcar el input), o undefined. */
export function errorDeCampo(errores: ErrorFormulario[], campo: string): string | undefined {
  const e = errores.find((x) => x.campo === campo);
  return e ? textoError({ ...e, linea: undefined }).replace(/^[^:]+:\s*/, "") : undefined;
}

/** Reasigna el número de línea del servidor al de la pantalla (cuando el cliente omitió filas vacías antes de enviar). */
export function remapearLineas(errores: ErrorFormulario[], coleccionKey: string, aLineaPantalla: number[]): ErrorFormulario[] {
  return errores.map((e) => {
    if (e.linea === undefined || !e.campo.startsWith(`${coleccionKey}.`)) return e;
    const original = aLineaPantalla[e.linea - 1];
    if (original === undefined) return e;
    const partes = e.campo.split(".");
    partes[1] = String(original - 1);
    return { ...e, linea: original, campo: partes.join(".") };
  });
}

/** Posiciones (0-based) de las filas que el usuario realmente llenó: se omiten las que siguen idénticas a la fila en blanco. */
export function indicesLlenos<T extends Record<string, string>>(filas: T[], blanca: T): number[] {
  const llaves = Object.keys(blanca) as (keyof T)[];
  return filas.flatMap((f, i) => (llaves.every((k) => String(f[k] ?? "").trim() === String(blanca[k] ?? "").trim()) ? [] : [i]));
}
