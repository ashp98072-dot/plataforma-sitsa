import { createHash } from "node:crypto";
import type { RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import type { SqlParams } from "@/lib/db";
import { CLAVE_ENVIO_REGEX } from "@/lib/idempotencia/clave-envio";
import { ErrorDominioFormulario } from "@/lib/validacion-formulario";

/**
 * IDEMPOTENCIA DE CREACIÓN — Solicitudes de Fondo y Gastos operativos (PR A).
 *
 * Contrato (clave OPCIONAL en la primera ventana de despliegue):
 *   - sin clave                       -> comportamiento legado: cada POST crea un registro.
 *   - clave nueva                     -> se crea y se guarda (clave + huella del contenido funcional).
 *   - misma clave + mismo contenido   -> se devuelve la creación original; no se crea otra.
 *   - misma clave + contenido distinto-> 409: una clave no puede reutilizarse para otra operación.
 *   - misma clave en OTRA empresa     -> independiente (UNIQUE por empresa_id + clave).
 *
 * La huella es SHA-256 de un JSON canónico del contenido funcional (lista blanca explícita por módulo, ver
 * `huellaSolicitudFondo`/`huellaGasto`): excluye ids autogenerados, códigos, timestamps y la propia clave, y solo guarda
 * el hash (nunca el contenido duplicado).
 */

export const TABLA_FONDOS = "tms_solicitudes_fondo";
export const TABLA_GASTOS = "tms_gastos_operativos";
export type TablaIdempotente = typeof TABLA_FONDOS | typeof TABLA_GASTOS;

/** Nombre de los índices UNIQUE (ver sql/migrate-2026-10-operaciones-idempotencia-fondos-gastos.sql). */
export const INDICE_CLAVE_FONDOS = "uq_fondo_empresa_clave";
export const INDICE_CLAVE_GASTOS = "uq_gastos_empresa_clave";

export const MENSAJE_CONFLICTO_IDEMPOTENCIA =
  "Esta operación ya se registró con datos distintos a los que envías ahora. Revisa el listado antes de volver a intentarlo.";

/** 409 explícito: la misma clave no puede reutilizarse para una operación diferente. */
export class ConflictoIdempotencia extends ErrorDominioFormulario {
  constructor() {
    super(MENSAJE_CONFLICTO_IDEMPOTENCIA, 409);
    this.name = "ConflictoIdempotencia";
  }
}

/** Valida (defensivo) la clave que llega del cliente; `null`/`undefined`/vacía = sin idempotencia (legado). */
export function normalizarClaveIdempotencia(valor: string | null | undefined): string | null {
  if (valor == null) return null;
  const limpia = String(valor).trim();
  if (!limpia) return null;
  if (!CLAVE_ENVIO_REGEX.test(limpia)) throw new ErrorDominioFormulario("La clave de envío no es válida.");
  return limpia;
}

/* ------------------------------------------------------------------ huella canónica */

const texto = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const entero = (v: unknown): number | null => (v == null || v === "" ? null : Number(v));
/** Importes/cantidades con 2 decimales fijos: 100 y 100.00 y "100" producen la misma huella. */
const dinero = (v: unknown, porDefecto: number | null = null): string | null => {
  const n = v == null || v === "" ? porDefecto : Number(v);
  return n == null || Number.isNaN(n) ? null : n.toFixed(2);
};

/** JSON con claves ordenadas y sin `undefined`: misma entrada lógica => mismos bytes. */
export function canonico(valor: unknown): string {
  if (Array.isArray(valor)) return `[${valor.map(canonico).join(",")}]`;
  if (valor && typeof valor === "object") {
    const o = valor as Record<string, unknown>;
    const claves = Object.keys(o).filter((k) => o[k] !== undefined).sort();
    return `{${claves.map((k) => `${JSON.stringify(k)}:${canonico(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(valor ?? null);
}

export function huellaDe(contenido: unknown): string {
  return createHash("sha256").update(canonico(contenido)).digest("hex");
}

/** Versión del algoritmo: si cambia la lista blanca, se incrementa para no comparar huellas incompatibles. */
const VERSION_HUELLA = 1;

type LineaHuellaFondo = {
  categoria: string; descripcion?: string | null; cantidad?: number; monto: number;
  fechaViaje?: string | null; empleadoId?: number | null; vehiculoId?: number | null; clienteId?: number | null; planId?: number | null;
  empleadoNombreOverride?: string | null; cuentaOverride?: string | null; cargoOverride?: string | null; metodoPago?: string | null;
};
type EntradaHuellaFondo = {
  entidadRequirenteId?: number; requirenteEmpleadoId?: number | null; requirenteNombre?: string | null;
  requirenteUsuarioId?: number | null; solicitanteUsuarioId?: number | null;
  fechaRequerimiento: string; observaciones?: string | null; lineas: LineaHuellaFondo[];
};

/** Contenido funcional de una Solicitud de Fondo. El ORDEN de las líneas es parte de la huella (se persiste como `orden`). */
export function huellaSolicitudFondo(input: EntradaHuellaFondo): string {
  const total = input.lineas.reduce((s, l) => s + (l.cantidad ?? 1) * l.monto, 0);
  return huellaDe({
    v: VERSION_HUELLA, tipo: "fondo",
    entidadRequirenteId: entero(input.entidadRequirenteId),
    requirenteEmpleadoId: entero(input.requirenteEmpleadoId),
    requirenteUsuarioId: entero(input.requirenteUsuarioId),
    // El texto libre solo cuenta cuando no hay usuario/empleado: con usuario, el servidor ignora el texto enviado.
    requirenteNombre: input.requirenteUsuarioId != null || input.requirenteEmpleadoId != null ? null : texto(input.requirenteNombre),
    solicitanteUsuarioId: entero(input.solicitanteUsuarioId),
    fechaRequerimiento: texto(input.fechaRequerimiento),
    observaciones: texto(input.observaciones),
    total: dinero(total),
    lineas: input.lineas.map((l) => ({
      categoria: texto(l.categoria), descripcion: texto(l.descripcion), cantidad: dinero(l.cantidad, 1), monto: dinero(l.monto),
      fechaViaje: texto(l.fechaViaje), empleadoId: entero(l.empleadoId), vehiculoId: entero(l.vehiculoId), clienteId: entero(l.clienteId),
      planId: entero(l.planId), empleadoNombreOverride: texto(l.empleadoNombreOverride), cuentaOverride: texto(l.cuentaOverride),
      cargoOverride: texto(l.cargoOverride), metodoPago: texto(l.metodoPago),
    })),
  });
}

type LineaHuellaGasto = {
  categoria: string; descripcion?: string | null; cantidad?: number; monto: number; metodoPago?: string | null; numeroCuentaPago?: string | null;
  fechaViaje?: string | null; empleadoId?: number | null; vehiculoId?: number | null; clienteId?: number | null; planId?: number | null;
};
type EntradaHuellaGasto = {
  fechaSolicitud: string; fechaViaje?: string | null; empleadoId?: number | null; vehiculoId?: number | null; clienteId?: number | null;
  planId?: number | null; categoria: string; descripcion?: string | null; cantidad?: number; monto?: number;
  metodoPago?: string | null; numeroCuentaPago?: string | null; tieneFactura?: boolean; observaciones?: string | null;
  entidadRequirenteId?: number; requirenteEmpleadoId?: number | null; requirenteNombre?: string | null;
  requirenteUsuarioId?: number | null; solicitanteUsuarioId?: number | null; lineas?: LineaHuellaGasto[];
};

/**
 * Contenido funcional de un Gasto. Con líneas, `monto`/`cantidad` de cabecera NO cuentan (el servidor los deriva de las
 * líneas): cuenta el total derivado. Sin líneas cuentan tal cual.
 */
export function huellaGasto(input: EntradaHuellaGasto): string {
  const conLineas = input.lineas !== undefined;
  const total = conLineas
    ? input.lineas!.reduce((s, l) => s + (l.cantidad ?? 1) * l.monto, 0)
    : (input.cantidad ?? 1) * (input.monto ?? 0);
  return huellaDe({
    v: VERSION_HUELLA, tipo: "gasto",
    fechaSolicitud: texto(input.fechaSolicitud), fechaViaje: texto(input.fechaViaje),
    empleadoId: entero(input.empleadoId), vehiculoId: entero(input.vehiculoId), clienteId: entero(input.clienteId), planId: entero(input.planId),
    categoria: texto(input.categoria), descripcion: texto(input.descripcion),
    cantidad: conLineas ? null : dinero(input.cantidad, 1), monto: conLineas ? null : dinero(input.monto),
    total: dinero(total),
    metodoPago: texto(input.metodoPago), numeroCuentaPago: texto(input.numeroCuentaPago), tieneFactura: input.tieneFactura ? 1 : 0,
    observaciones: texto(input.observaciones),
    entidadRequirenteId: entero(input.entidadRequirenteId),
    requirenteEmpleadoId: entero(input.requirenteEmpleadoId),
    requirenteUsuarioId: entero(input.requirenteUsuarioId),
    requirenteNombre: input.requirenteUsuarioId != null || input.requirenteEmpleadoId != null ? null : texto(input.requirenteNombre),
    solicitanteUsuarioId: entero(input.solicitanteUsuarioId),
    lineas: conLineas
      ? input.lineas!.map((l) => ({
          categoria: texto(l.categoria), descripcion: texto(l.descripcion), cantidad: dinero(l.cantidad, 1), monto: dinero(l.monto),
          metodoPago: texto(l.metodoPago), numeroCuentaPago: texto(l.numeroCuentaPago), fechaViaje: texto(l.fechaViaje),
          empleadoId: entero(l.empleadoId), vehiculoId: entero(l.vehiculoId), clienteId: entero(l.clienteId), planId: entero(l.planId),
        }))
      : null,
  });
}

/* ------------------------------------------------------------------ persistencia */

type CodigoMysql = { code?: string; errno?: number; message?: string } | null | undefined;

/** `ER_BAD_FIELD_ERROR` (1054): la migración de idempotencia todavía no se aplicó -> se opera en modo legado. */
export function esColumnaInexistente(error: unknown): boolean {
  const e = error as CodigoMysql;
  return e?.code === "ER_BAD_FIELD_ERROR" || e?.errno === 1054;
}

/** `ER_DUP_ENTRY` (1062) de ESTE índice de clave, y solo de él (otros UNIQUE, p. ej. el de código, se propagan). */
export function esDuplicadoDeClave(error: unknown, indice: string): boolean {
  const e = error as CodigoMysql;
  return !!e && (e.code === "ER_DUP_ENTRY" || e.errno === 1062) && String(e.message ?? "").includes(indice);
}

export type BusquedaClave =
  | { tipo: "nueva" }
  | { tipo: "existente"; id: number }
  | { tipo: "sin_soporte" };

/** Lector de filas: el pool (`query`) o una conexión de transacción (`conn.query`). */
export type LectorFilas = (sql: string, params: SqlParams) => Promise<RowDataPacket[]>;

export const lectorDeConexion = (conn: PoolConnection): LectorFilas => async (sql, params) => {
  const [filas] = await conn.query<RowDataPacket[]>(sql, params);
  return filas;
};

/**
 * Busca la creación previa de esta clave (aislada por empresa). Si existe con la MISMA huella la devuelve; con otra,
 * lanza 409. Si la columna no existe aún (migración pendiente) responde `sin_soporte` y el llamador crea en modo legado.
 */
export async function buscarCreacionPorClave(
  leer: LectorFilas, tabla: TablaIdempotente, empresaId: number, clave: string, huella: string,
): Promise<BusquedaClave> {
  let filas: RowDataPacket[];
  try {
    filas = await leer(
      `SELECT id, huella_idempotencia FROM ${tabla} WHERE empresa_id = ? AND clave_idempotencia = ? LIMIT 1`,
      [empresaId, clave],
    );
  } catch (error) {
    if (esColumnaInexistente(error)) return { tipo: "sin_soporte" };
    throw error;
  }
  const fila = filas[0];
  if (!fila) return { tipo: "nueva" };
  if (String(fila.huella_idempotencia ?? "") !== huella) throw new ConflictoIdempotencia();
  return { tipo: "existente", id: Number(fila.id) };
}
