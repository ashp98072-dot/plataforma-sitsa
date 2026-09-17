import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { getPool, query } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import { camposProveedor, type Proveedor, type ProveedorDatos } from "./proveedor-schema";

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
    if (id === undefined) {
      const [result] = await conn.execute<ResultSetHeader>(`INSERT INTO compras_proveedores
        (empresa_id, ${camposProveedor.join(", ")}, creado_por, actualizado_por)
        VALUES (${Array(camposProveedor.length + 3).fill("?").join(", ")})`,
      [empresaId, ...camposProveedor.map(c => despues[c]), usuarioId, usuarioId]);
      id = result.insertId;
    } else {
      const campos = camposProveedor.filter(c => datos[c] !== undefined);
      await conn.execute(`UPDATE compras_proveedores SET ${campos.map(c => `${c} = ?`).join(", ")}, actualizado_por = ? WHERE empresa_id = ? AND id = ?`,
        [...campos.map(c => despues[c]), usuarioId, empresaId, id]);
    }
    const accion = !antes ? "crear_proveedor_compras" : antes.activo !== despues.activo
      ? despues.activo ? "reactivar_proveedor_compras" : "inactivar_proveedor_compras" : "editar_proveedor_compras";
    // No replicar cuentas bancarias, correos, teléfonos o direcciones en auditoría.
    const resumen = (p: ProveedorDatos) => ({ nombre_comercial: p.nombre_comercial, razon_social: p.razon_social, nit: p.nit, activo: p.activo, metodo_pago_habitual: p.metodo_pago_habitual, dias_credito: p.dias_credito });
    await registrarAuditoriaTx(conn, { empresaId, usuario, accion, modulo: "compras_proveedores",
      detalle: JSON.stringify({ proveedorId: id, usuarioId, campos: Object.keys(datos), antes: antes ? resumen(antes) : null, despues: resumen(despues) }) });
    await conn.commit();
    return id;
  } catch (error) { await conn.rollback(); throw error; }
  finally { conn.release(); }
}
