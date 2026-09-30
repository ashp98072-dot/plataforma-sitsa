import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { getPool, query } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import { camposProveedor, type Proveedor, type ProveedorDatos } from "./proveedor-schema";
import { normalizarNitProveedor, normalizarNombreProveedor } from "./proveedor-identidad";

export type ProveedorDuplicadoInfo = { id: number; nombre_comercial: string; nit: string | null; activo: boolean };

/**
 * COMPRAS — anti-duplicados de proveedores (secciones 6-11 del ticket). El código exacto de los dos
 * índices UNIQUE nuevos (sql/migrate-2026-09-compras-proveedores-unicidad.sql) — mismo estilo que
 * esDuplicadoFacturaUnica en src/lib/compras/requerimientos.ts.
 */
export class ErrorProveedorDuplicado extends Error {
  codigo: "PROVEEDOR_DUPLICADO" | "PROVEEDOR_DUPLICADO_INACTIVO";
  proveedorExistente: ProveedorDuplicadoInfo;
  constructor(codigo: "PROVEEDOR_DUPLICADO" | "PROVEEDOR_DUPLICADO_INACTIVO", proveedorExistente: ProveedorDuplicadoInfo) {
    super(codigo === "PROVEEDOR_DUPLICADO" ? "Ya existe un proveedor con esos datos." : "Este proveedor ya existe pero está inactivo.");
    this.codigo = codigo;
    this.proveedorExistente = proveedorExistente;
  }
}
/** ER_DUP_ENTRY (1062) de uq_cb_proveedor_nombre / uq_cb_proveedor_nit, y solo de esos (red de seguridad ante carreras). */
export const esDuplicadoProveedorUnico = (error: unknown): boolean => {
  const e = error as { code?: string; errno?: number; message?: string } | null;
  if (!e || (e.code !== "ER_DUP_ENTRY" && e.errno !== 1062)) return false;
  const msg = String(e.message ?? "");
  return msg.includes("uq_cb_proveedor_nombre") || msg.includes("uq_cb_proveedor_nit");
};

function mapear(row: RowDataPacket): Proveedor {
  const datos = Object.fromEntries(camposProveedor.map(c => [c,
    c === "activo" ? Boolean(row[c]) : c === "dias_credito" ? (row[c] == null ? null : Number(row[c])) : (row[c] == null ? null : String(row[c]))]));
  return { ...datos, id: Number(row.id), empresa_id: Number(row.empresa_id) } as Proveedor;
}
const columnas = `id, empresa_id, ${camposProveedor.join(", ")}`;
export async function listarProveedores(empresaId: number, buscar = "") {
  // Búsqueda literal; no fuzzy matching ni interpretación de comodines del usuario.
  return (await query<RowDataPacket[]>(`SELECT ${columnas} FROM compras_proveedores
    WHERE empresa_id = ? AND (? = '' OR LOCATE(?, nombre_comercial) > 0
      OR LOCATE(?, COALESCE(razon_social, '')) > 0 OR LOCATE(?, COALESCE(nit, '')) > 0)
    ORDER BY nombre_comercial, id`, [empresaId, buscar, buscar, buscar, buscar])).map(mapear);
}
export async function obtenerProveedor(empresaId: number, id: number) {
  const rows = await query<RowDataPacket[]>(`SELECT ${columnas} FROM compras_proveedores WHERE empresa_id = ? AND id = ?`, [empresaId, id]);
  return rows[0] ? mapear(rows[0]) : null;
}
/** SELECT crudo detrás de ambas rutas de detección de duplicados (chequeo proactivo y red de seguridad ante ER_DUP_ENTRY). */
const sqlBuscarDuplicado = (excluirId: boolean) => `SELECT id, nombre_comercial, nit, activo FROM compras_proveedores
   WHERE empresa_id = ? AND (nombre_normalizado = ? OR (? IS NOT NULL AND nit_normalizado = ?)) ${excluirId ? "AND id <> ?" : ""} LIMIT 1`;
const paramsBuscarDuplicado = (empresaId: number, nombreNorm: string, nitNorm: string | null, id?: number) =>
  id !== undefined ? [empresaId, nombreNorm, nitNorm, nitNorm, id] : [empresaId, nombreNorm, nitNorm, nitNorm];
const aInfoDuplicado = (row: RowDataPacket): ProveedorDuplicadoInfo =>
  ({ id: Number(row.id), nombre_comercial: String(row.nombre_comercial), nit: row.nit == null ? null : String(row.nit), activo: Boolean(row.activo) });

export async function guardarProveedor(empresaId: number, usuarioId: number, usuario: string, datos: Partial<ProveedorDatos>, id?: number) {
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    let antes: Proveedor | null = null;
    if (id !== undefined) {
      const [rows] = await conn.query<RowDataPacket[]>(`SELECT ${columnas} FROM compras_proveedores WHERE empresa_id = ? AND id = ? FOR UPDATE`, [empresaId, id]);
      if (!rows[0]) { await conn.rollback(); return null; }
      antes = mapear(rows[0]);
    }
    const despues = Object.fromEntries(camposProveedor.map(c => [c, datos[c] !== undefined ? datos[c] : antes ? antes[c] : c === "activo" ? true : null])) as ProveedorDatos;

    // ANTI-DUPLICADOS (secciones 6-11 del ticket) — SIEMPRE recalculado por el backend, nunca confiado del cliente.
    // Mismo nombre normalizado, o mismo NIT normalizado si no está vacío, identifican al MISMO proveedor de esta
    // empresa. FOR UPDATE + dentro de la transacción: reduce (no elimina del todo) la ventana de carrera — el índice
    // UNIQUE de BD (esDuplicadoProveedorUnico, más abajo) es la protección estructural definitiva.
    const nombreNormalizado = normalizarNombreProveedor(despues.nombre_comercial);
    const nitNormalizado = normalizarNitProveedor(despues.nit);
    const [dupRows] = await conn.query<RowDataPacket[]>(
      sqlBuscarDuplicado(id !== undefined),
      paramsBuscarDuplicado(empresaId, nombreNormalizado, nitNormalizado, id),
    );
    if (dupRows[0]) {
      const existente = aInfoDuplicado(dupRows[0]);
      throw new ErrorProveedorDuplicado(existente.activo ? "PROVEEDOR_DUPLICADO" : "PROVEEDOR_DUPLICADO_INACTIVO", existente);
    }

    if (id === undefined) {
      const [result] = await conn.execute<ResultSetHeader>(`INSERT INTO compras_proveedores
        (empresa_id, ${camposProveedor.join(", ")}, nombre_normalizado, nit_normalizado, creado_por, actualizado_por)
        VALUES (${Array(camposProveedor.length + 5).fill("?").join(", ")})`,
      [empresaId, ...camposProveedor.map(c => despues[c]), nombreNormalizado, nitNormalizado, usuarioId, usuarioId]);
      id = result.insertId;
    } else {
      const campos = camposProveedor.filter(c => datos[c] !== undefined);
      // Solo se reescribe la identidad normalizada si el PATCH toca nombre_comercial o nit (evita UPDATEs sin cambios reales).
      const tocaIdentidad = campos.includes("nombre_comercial") || campos.includes("nit");
      const sets = [...campos.map(c => `${c} = ?`), ...(tocaIdentidad ? ["nombre_normalizado = ?", "nit_normalizado = ?"] : [])];
      const valores = [...campos.map(c => despues[c]), ...(tocaIdentidad ? [nombreNormalizado, nitNormalizado] : [])];
      await conn.execute(`UPDATE compras_proveedores SET ${sets.join(", ")}, actualizado_por = ? WHERE empresa_id = ? AND id = ?`,
        [...valores, usuarioId, empresaId, id]);
    }
    const accion = !antes ? "crear_proveedor_compras" : antes.activo !== despues.activo
      ? despues.activo ? "reactivar_proveedor_compras" : "inactivar_proveedor_compras" : "editar_proveedor_compras";
    // No replicar cuentas bancarias, correos, teléfonos o direcciones en auditoría.
    const resumen = (p: ProveedorDatos) => ({ nombre_comercial: p.nombre_comercial, razon_social: p.razon_social, nit: p.nit, activo: p.activo, metodo_pago_habitual: p.metodo_pago_habitual, dias_credito: p.dias_credito });
    await registrarAuditoriaTx(conn, { empresaId, usuario, accion, modulo: "compras_proveedores",
      detalle: JSON.stringify({ proveedorId: id, usuarioId, campos: Object.keys(datos), antes: antes ? resumen(antes) : null, despues: resumen(despues) }) });
    await conn.commit();
    return id;
  } catch (error) {
    try { await conn.rollback(); } catch { /* conservar el error original */ }
    if (error instanceof ErrorProveedorDuplicado) throw error;
    // Red de seguridad ante una carrera real que el SELECT FOR UPDATE no alcanzó a bloquear (dos altas simultáneas
    // del mismo proveedor): el índice UNIQUE de BD sigue siendo quien decide. Se reconsulta (fuera de la transacción
    // ya revertida) para devolver la misma respuesta estructurada 409 que el chequeo proactivo.
    if (esDuplicadoProveedorUnico(error)) {
      const nombreNormalizado = normalizarNombreProveedor(datos.nombre_comercial ?? "");
      const nitNormalizado = normalizarNitProveedor(datos.nit);
      const filas = await query<RowDataPacket[]>(sqlBuscarDuplicado(id !== undefined), paramsBuscarDuplicado(empresaId, nombreNormalizado, nitNormalizado, id));
      const existente = filas[0] ? aInfoDuplicado(filas[0]) : { id: 0, nombre_comercial: "", nit: null, activo: true };
      throw new ErrorProveedorDuplicado(existente.activo ? "PROVEEDOR_DUPLICADO" : "PROVEEDOR_DUPLICADO_INACTIVO", existente);
    }
    throw error;
  }
  finally { conn.release(); }
}
