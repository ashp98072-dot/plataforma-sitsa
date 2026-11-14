/**
 * URGENTE — "No se pudo generar un código de plan único" disfrazaba cualquier error SQL.
 *
 * El alta individual (POST /tms/planes) y la importación de Excel envolvían el INSERT de `tms_planes_viaje` en un
 * `catch {}` vacío que regeneraba el código ante CUALQUIER error. Una columna inexistente, una FK, un trigger o un
 * timeout acababan reportados como un falso error de numeración tras 5 intentos inútiles, y la causa real se perdía.
 *
 * Este módulo es PURO (sin acceso a base de datos ni a otros módulos del proyecto, para que ningún mock de
 * `codigo-plan` lo altere) y centraliza dos reglas:
 *   1. SOLO una colisión real del UNIQUE KEY (empresa_id, codigo) —`uq_plan` en sql/schema.sql— se reintenta.
 *   2. Cualquier otro error se propaga TAL CUAL al manejador transaccional del llamador (rollback + error real).
 */

/** Nombre del UNIQUE KEY (empresa_id, codigo) de tms_planes_viaje (sql/schema.sql). El otro único, uq_tmsplanes_empresa_id, es (empresa_id, id). */
export const INDICE_UNICO_CODIGO_PLAN = "uq_plan";

/** Intentos máximos de INSERT por plan (igual que el comportamiento anterior). */
export const MAX_INTENTOS_CODIGO_PLAN = 5;

export type IntentoCodigoPlan = { empresaId: number; codigo: string };

type ErrorSqlLike = { code?: unknown; errno?: unknown; sqlMessage?: unknown; message?: unknown };

/** Segmentos entre comillas simples del mensaje: independiente del idioma del servidor (no depende de la palabra "key"). */
function segmentosEntreComillas(texto: string): string[] {
  return [...texto.matchAll(/'([^']*)'/g)].map((m) => m[1]);
}

/**
 * true SOLO si `e` es una violación de UNIQUE (ER_DUP_ENTRY / errno 1062) del índice (empresa_id, codigo).
 *
 * MariaDB informa `Duplicate entry '7-PLAN-20261113-005' for key 'uq_plan'` (MySQL 8: `'tms_planes_viaje.uq_plan'`).
 * Un duplicado de PRIMARY o de uq_tmsplanes_empresa_id NO es una colisión de código y no debe reintentarse.
 * Respaldo para instalaciones con otro nombre de índice: si se conoce el intento, el valor duplicado es exactamente
 * `<empresa_id>-<codigo>` (el formato del índice compuesto).
 */
export function esColisionIndiceCodigoPlan(e: unknown, intento?: IntentoCodigoPlan): boolean {
  if (!e || typeof e !== "object") return false;
  const err = e as ErrorSqlLike;
  if (!(err.code === "ER_DUP_ENTRY" || err.errno === 1062)) return false;
  const segmentos = segmentosEntreComillas(String(err.sqlMessage ?? err.message ?? ""));
  if (segmentos.some((s) => s === INDICE_UNICO_CODIGO_PLAN || s.endsWith(`.${INDICE_UNICO_CODIGO_PLAN}`))) return true;
  if (intento && segmentos.includes(`${intento.empresaId}-${intento.codigo}`)) return true;
  return false;
}

/** Código SQL legible del error (p. ej. ER_SIGNAL_EXCEPTION, ER_BAD_FIELD_ERROR) o null: apto para mostrar al usuario (nunca el texto SQL). */
export function codigoErrorSql(e: unknown): string | null {
  if (!e || typeof e !== "object") return null;
  const code = (e as ErrorSqlLike).code;
  return typeof code === "string" && /^ER_[A-Z0-9_]+$/.test(code) ? code : null;
}

/**
 * Texto corto para el USUARIO: código `ER_*` y, en errores de llave foránea, el NOMBRE de la restricción (identificador de
 * esquema, p. ej. fk_tmsplan_tc_vehiculo). Nunca el texto SQL, valores ni nombres de base de datos. Vacío si no hay código.
 */
export function detalleErrorSqlUsuario(e: unknown): string {
  const code = codigoErrorSql(e);
  if (!code) return "";
  const msg = String((e as ErrorSqlLike).sqlMessage ?? "");
  const fk = code.startsWith("ER_NO_REFERENCED_ROW") || code.startsWith("ER_ROW_IS_REFERENCED") ? msg.match(/CONSTRAINT `([A-Za-z0-9_]{1,64})`/)?.[1] : undefined;
  return fk ? `${code}, restricción ${fk}` : code;
}

/** Resumen para la BITÁCORA DEL SERVIDOR (code/errno/sqlState/sqlMessage); no se devuelve al cliente. */
export function resumenErrorSql(e: unknown): { code: unknown; errno: unknown; sqlState: unknown; sqlMessage: unknown } {
  const err = (e && typeof e === "object" ? e : {}) as ErrorSqlLike & { sqlState?: unknown };
  return { code: err.code ?? null, errno: err.errno ?? null, sqlState: err.sqlState ?? null, sqlMessage: err.sqlMessage ?? err.message ?? String(e) };
}

/** Se agotaron los intentos y TODOS fueron colisiones reales de código (la única causa que justifica el mensaje de "código único"). */
export class CodigoPlanAgotadoError extends Error {
  constructor(readonly intentos: number, readonly ultimoCodigo: string) {
    super(`No se pudo generar un código de plan único tras ${intentos} intentos (último: ${ultimoCodigo}).`);
    this.name = "CodigoPlanAgotadoError";
  }
}

/** Número final de un código PLAN-YYYYMMDD-### (o null si no tiene la forma esperada). */
export function numeroDeCodigoPlan(codigo: string): number | null {
  const m = codigo.match(/-(\d+)$/);
  return m ? Number(m[1]) : null;
}

/** Siguiente código por incremento numérico (o null si el código no termina en dígitos). */
export function incrementarCodigoPlan(codigo: string): string | null {
  const m = codigo.match(/^(.*-)(\d+)$/);
  if (!m) return null;
  return `${m[1]}${String(Number(m[2]) + 1).padStart(Math.max(3, m[2].length), "0")}`;
}

async function siguienteDistinto(
  siguienteCodigo: (colisionado: string) => Promise<string>,
  colisionado: string,
): Promise<string> {
  const propuesto = await siguienteCodigo(colisionado);
  const a = numeroDeCodigoPlan(colisionado);
  const b = numeroDeCodigoPlan(propuesto);
  // Progreso garantizado: dentro de una transacción REPEATABLE READ el generador puede no ver la fila que acaba de
  // colisionar (otra transacción la confirmó después del snapshot) y proponer el MISMO código una y otra vez.
  if (propuesto !== colisionado && (a == null || b == null || b > a)) return propuesto;
  return incrementarCodigoPlan(colisionado) ?? propuesto;
}

/**
 * Ejecuta `intentarInsertar(codigo)` y, SOLO si falla por colisión real de (empresa_id, codigo), reintenta con otro
 * código (máx. `maxIntentos` INSERT). Cualquier otro error se relanza sin tocar: el llamador lo deja subir al catch
 * transaccional (rollback) y el usuario recibe el error verdadero.
 *
 * Es seguro dentro de una transacción InnoDB: un INSERT que viola un UNIQUE solo revierte esa sentencia, no la
 * transacción, de modo que las escrituras previas del mismo alta siguen intactas para el siguiente intento.
 */
export async function insertarPlanConCodigoUnico(opts: {
  empresaId: number;
  codigoInicial: string;
  /** Ejecuta el INSERT con el código dado y devuelve el id del plan. Debe lanzar el error original de la BD. */
  intentarInsertar: (codigo: string) => Promise<number>;
  /** Propone un código nuevo tras una colisión (recibe el que colisionó). */
  siguienteCodigo: (colisionado: string) => Promise<string>;
  maxIntentos?: number;
}): Promise<{ planId: number; codigo: string }> {
  const max = opts.maxIntentos ?? MAX_INTENTOS_CODIGO_PLAN;
  let codigo = opts.codigoInicial;
  for (let intento = 1; intento <= max; intento++) {
    try {
      return { planId: await opts.intentarInsertar(codigo), codigo };
    } catch (e) {
      if (!esColisionIndiceCodigoPlan(e, { empresaId: opts.empresaId, codigo })) throw e;
      if (intento === max) break;
      codigo = await siguienteDistinto(opts.siguienteCodigo, codigo);
    }
  }
  throw new CodigoPlanAgotadoError(max, codigo);
}
