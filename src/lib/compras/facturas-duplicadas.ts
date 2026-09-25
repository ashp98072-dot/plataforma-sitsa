import type { RowDataPacket } from "mysql2";
import { normalizarFacturaCompra, type FacturaExistente } from "./factura-compra";

/**
 * COMPRAS — búsqueda de facturas ya registradas (servidor). Identidad: empresa + proveedor + serie normalizada + número
 * normalizado (ver factura-compra.ts). La empresa SIEMPRE llega del llamador (sesión), nunca del cliente.
 *
 * La BD hace un prefiltro por empresa + proveedor + serie/número recortados y con espacios colapsados (la colación
 * utf8mb4_unicode_ci ya ignora mayúsculas y acentos: es un SUPERCONJUNTO) y el resultado se reconfirma en JS con la MISMA
 * normalización que usa el formulario, así que un falso positivo de colación nunca bloquea. El estado del requerimiento
 * (Pendiente, Autorizada o Rechazada) NO importa: una factura registrada cuenta siempre.
 */
export type Lector = (sql: string, params: unknown[]) => Promise<RowDataPacket[]>;

/** Expresión SQL de "texto normalizado" (recorta, colapsa espacios); la BD compara sin distinguir mayúsculas/acentos. */
export const SQL_NORMALIZADO = (columna: string) => `TRIM(REGEXP_REPLACE(${columna}, '[[:space:]]+', ' '))`;

export type OpcionesBusqueda = {
  /** Excluye SOLO esa línea (edición: una línea no se detecta a sí misma; otra línea del mismo requerimiento SÍ cuenta). */
  excluirLineaId?: number;
  /** Excluye TODAS las líneas de ese requerimiento (guardado: su estado final lo gobierna el payload, ya validado en memoria). */
  excluirRequerimientoId?: number;
  /** `FOR UPDATE`: bloquea el rango leído dentro de la transacción de guardado (defensa adicional, ver docs de concurrencia). */
  bloquear?: boolean;
};

export async function buscarFacturaExistente(
  leer: Lector, empresaId: number, proveedorId: number, serie: string | null | undefined, numero: string | null | undefined, opciones: OpcionesBusqueda = {},
): Promise<FacturaExistente | null> {
  const f = normalizarFacturaCompra(serie, numero);
  if (!f || !Number.isInteger(proveedorId) || proveedorId <= 0) return null; // sin número (o sin proveedor): no hay control
  const params: unknown[] = [empresaId, proveedorId, f.numero, f.serie];
  let filtro = "";
  if (opciones.excluirLineaId != null) { filtro += " AND l.id <> ?"; params.push(opciones.excluirLineaId); }
  if (opciones.excluirRequerimientoId != null) { filtro += " AND l.requerimiento_id <> ?"; params.push(opciones.excluirRequerimientoId); }
  const filas = await leer(
    `SELECT l.id AS linea_id, l.requerimiento_id, r.codigo AS requerimiento_codigo, r.estado AS requerimiento_estado,
            DATE_FORMAT(l.fecha, '%Y-%m-%d') AS fecha, l.serie_factura, l.numero_factura, l.proveedor_nombre_snapshot
     FROM compras_requerimiento_lineas l
     INNER JOIN compras_requerimientos r ON r.empresa_id = l.empresa_id AND r.id = l.requerimiento_id
     WHERE l.empresa_id = ? AND l.proveedor_id = ? AND l.numero_factura IS NOT NULL
       AND ${SQL_NORMALIZADO("l.numero_factura")} = ?
       AND ${SQL_NORMALIZADO("COALESCE(l.serie_factura, '')")} = ?${filtro}
     ORDER BY l.id LIMIT 20${opciones.bloquear ? " FOR UPDATE" : ""}`,
    params,
  );
  for (const r of filas) {
    const otra = normalizarFacturaCompra(r.serie_factura, r.numero_factura);
    if (otra && otra.clave === f.clave) {
      return {
        requerimientoId: Number(r.requerimiento_id), requerimientoCodigo: String(r.requerimiento_codigo), lineaId: Number(r.linea_id),
        proveedorNombre: String(r.proveedor_nombre_snapshot ?? ""), serie: r.serie_factura == null ? null : String(r.serie_factura),
        numero: String(r.numero_factura), fecha: String(r.fecha), estado: String(r.requerimiento_estado),
      };
    }
  }
  return null;
}

// ------------------------------------------------------------------------------------------------ concurrencia
export const clavesLockFacturas = (empresaId: number, proveedorIds: number[]) =>
  [...new Set(proveedorIds)].sort((a, b) => a - b).map((p) => `compras_facturas_${empresaId}_${p}`);
export const SEGUNDOS_LOCK_FACTURAS = 8;

/**
 * Serializa a los escritores de facturas de UN proveedor con GET_LOCK (por conexión; independiente del nivel de aislamiento).
 * Sin una restricción UNIQUE en BD esto es lo que evita que dos guardados simultáneos inserten la misma factura desde ESTA
 * aplicación; NO protege contra inserciones manuales fuera de ella (para eso hace falta el índice único propuesto en
 * sql/preflight-2026-09-compras-facturas-unicas.sql). Orden estable por proveedor: sin deadlocks entre guardados.
 */
export async function adquirirLocksFacturas(
  conn: { query: (sql: string, params: unknown[]) => Promise<unknown> }, empresaId: number, proveedorIds: number[],
): Promise<{ ok: boolean; adquiridos: string[] }> {
  const adquiridos: string[] = [];
  for (const clave of clavesLockFacturas(empresaId, proveedorIds)) {
    let ok = false;
    try {
      const [rows] = (await conn.query("SELECT GET_LOCK(?, ?) AS l", [clave, SEGUNDOS_LOCK_FACTURAS])) as [RowDataPacket[]];
      ok = Number(rows[0]?.l) === 1;
    } catch { ok = false; }
    if (!ok) return { ok: false, adquiridos };
    adquiridos.push(clave);
  }
  return { ok: true, adquiridos };
}
export async function liberarLocksFacturas(conn: { query: (sql: string, params: unknown[]) => Promise<unknown> }, claves: string[]) {
  for (const c of claves) { try { await conn.query("SELECT RELEASE_LOCK(?) AS l", [c]); } catch { /* el lock se libera al cerrar la conexión */ } }
}
