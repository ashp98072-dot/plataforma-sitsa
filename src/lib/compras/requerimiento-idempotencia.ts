import { CLAVE_ENVIO_REGEX } from "@/lib/idempotencia/clave-envio";
import { huellaDe, type LectorFilas } from "@/lib/tms/idempotencia-envio";
import { centavosCompra, importeCompra, type LineaCompraDatos } from "./requerimiento-schema";

/**
 * IDEMPOTENCIA DE CREACIÓN — Requerimientos de Compras (PR B). Mismo contrato que Fondos y Gastos (PR A,
 * src/lib/tms/idempotencia-envio.ts):
 *   - sin clave                        -> comportamiento legado (cada POST crea).
 *   - misma clave + mismo contenido    -> se devuelve la creación original.
 *   - misma clave + contenido distinto -> 409.
 *   - clave distinta                   -> creación legítima distinta (nunca hay UNIQUE por contenido).
 *   - la carrera la decide UNIQUE (empresa_id, clave_idempotencia).
 *
 * Diferencias propias de Compras respecto de PR A, que este módulo contempla:
 *   - El payload es snake_case y el esquema es `.strict()`: la clave viaja como `clave_idempotencia`.
 *   - Las facturas se serializan con GET_LOCK por proveedor y un reintento con facturas ya NO falla por «factura duplicada»
 *     antes de llegar al UNIQUE: la búsqueda por clave debe ir ANTES de esas validaciones (y repetirse dentro de la
 *     transacción, ya con el lock, para la petición que esperó al ganador).
 *   - Los errores de negocio son `ErrorCompra` (lo define requerimientos.ts, que importa este módulo): aquí solo se
 *     devuelve el resultado de la búsqueda y es el llamador quien lanza el 409.
 */

export const TABLA_COMPRAS = "compras_requerimientos";
/** Ver sql/migrate-2026-10-compras-idempotencia-requerimientos.sql. */
export const INDICE_CLAVE_COMPRAS = "uq_compras_req_empresa_clave";

/** Versión del algoritmo de huella: si cambia la lista blanca, se incrementa para no comparar huellas incompatibles. */
const VERSION_HUELLA = 1;

const texto = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const entero = (v: unknown): number | null => (v == null || v === "" ? null : Number(v));

type EntradaHuellaCompra = {
  fecha_requerimiento: string;
  entidad_requirente_id: number;
  requirente_usuario_id: number | null;
  encargado_compras_usuario_id?: number | null;
  observaciones?: string | null;
  lineas: Pick<LineaCompraDatos, "vehiculo_id" | "unidad_descripcion" | "fecha" | "serie_factura" | "numero_factura" | "proveedor_id"
    | "repuesto_descripcion" | "metodo_pago" | "condicion_pago" | "total" | "observaciones">[];
};

/**
 * Contenido funcional de un Requerimiento de Compras (ya validado/normalizado por zod): cabecera, observaciones, total y
 * líneas EN ORDEN (la posición se persiste como `orden`). Excluye `id`, código, timestamps, snapshots derivados del servidor
 * (proveedor, banco, cuenta, nombres) y la propia clave. Solo se guarda el hash.
 */
export function huellaRequerimiento(datos: EntradaHuellaCompra): string {
  const total = importeCompra(datos.lineas.reduce((suma, l) => suma + centavosCompra(l.total), 0));
  return huellaDe({
    v: VERSION_HUELLA, tipo: "compra",
    fecha_requerimiento: texto(datos.fecha_requerimiento),
    entidad_requirente_id: entero(datos.entidad_requirente_id),
    requirente_usuario_id: entero(datos.requirente_usuario_id),
    encargado_compras_usuario_id: entero(datos.encargado_compras_usuario_id),
    observaciones: texto(datos.observaciones),
    total,
    lineas: datos.lineas.map(l => ({
      vehiculo_id: entero(l.vehiculo_id), unidad_descripcion: texto(l.unidad_descripcion), fecha: texto(l.fecha),
      serie_factura: texto(l.serie_factura), numero_factura: texto(l.numero_factura), proveedor_id: entero(l.proveedor_id),
      repuesto_descripcion: texto(l.repuesto_descripcion), metodo_pago: texto(l.metodo_pago), condicion_pago: texto(l.condicion_pago),
      total: importeCompra(centavosCompra(l.total)), observaciones: texto(l.observaciones),
    })),
  });
}

/** Defensa en profundidad: zod ya valida el formato; aquí solo se confirma antes de tocar la base. */
export function claveValidaCompra(clave: string | undefined | null): clave is string {
  return typeof clave === "string" && CLAVE_ENVIO_REGEX.test(clave);
}

export type ResultadoCreacionCompra = { id: number; codigo: string; version: number };
export type BusquedaClaveCompra =
  | { tipo: "nueva" }
  | { tipo: "existente"; resultado: ResultadoCreacionCompra }
  | { tipo: "conflicto" }
  | { tipo: "sin_soporte" };

const esColumnaInexistente = (error: unknown) => {
  const e = error as { code?: string; errno?: number } | null;
  return e?.code === "ER_BAD_FIELD_ERROR" || e?.errno === 1054;
};

/**
 * Busca la creación previa de esta clave (aislada por empresa). Misma huella => `existente` con el id/código/versión
 * vigentes; otra huella => `conflicto`; columna aún inexistente (migración pendiente) => `sin_soporte` (modo legado).
 */
export async function buscarRequerimientoPorClave(leer: LectorFilas, empresaId: number, clave: string, huella: string): Promise<BusquedaClaveCompra> {
  let filas;
  try {
    filas = await leer(
      `SELECT id, codigo, version, huella_idempotencia FROM ${TABLA_COMPRAS} WHERE empresa_id = ? AND clave_idempotencia = ? LIMIT 1`,
      [empresaId, clave],
    );
  } catch (error) {
    if (esColumnaInexistente(error)) return { tipo: "sin_soporte" };
    throw error;
  }
  const fila = filas[0];
  if (!fila) return { tipo: "nueva" };
  if (String(fila.huella_idempotencia ?? "") !== huella) return { tipo: "conflicto" };
  return { tipo: "existente", resultado: { id: Number(fila.id), codigo: String(fila.codigo), version: Number(fila.version) } };
}
