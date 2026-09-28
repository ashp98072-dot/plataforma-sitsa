import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { getPool, query } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import { camposProveedorRrhh, type ProveedorRrhh, type ProveedorRrhhDatos } from "./proveedor-schema";

/**
 * RRHH-REQUERIMIENTOS-PROVEEDORES-1 — proveedores propios de RRHH. Mismo patrón exacto que
 * src/lib/compras/proveedores.ts (listar/obtener/guardar con auditoría), tabla independiente `rrhh_proveedores`.
 * Nunca se elimina físicamente: "desactivar" es `activo = 0` — un proveedor histórico sigue visible en requerimientos
 * pasados (su snapshot vive en la línea) y deja de ofrecerse para líneas nuevas (ver requerimientos.ts).
 */
function mapear(row: RowDataPacket): ProveedorRrhh {
  const datos = Object.fromEntries(camposProveedorRrhh.map(c => [c,
    c === "activo" ? Boolean(row[c]) : c === "dias_credito" ? (row[c] == null ? null : Number(row[c])) : (row[c] == null ? null : String(row[c]))]));
  return { ...datos, id: Number(row.id), empresa_id: Number(row.empresa_id) } as ProveedorRrhh;
}
const columnas = `id, empresa_id, ${camposProveedorRrhh.join(", ")}`;

export async function listarProveedoresRrhh(empresaId: number, buscar = ""): Promise<ProveedorRrhh[]> {
  // Búsqueda literal (sin tildes/mayúsculas ya normalizado por el caller si aplica); igual criterio que Compras.
  return (await query<RowDataPacket[]>(`SELECT ${columnas} FROM rrhh_proveedores
    WHERE empresa_id = ? AND (? = '' OR LOCATE(?, nombre_comercial) > 0
      OR LOCATE(?, COALESCE(razon_social, '')) > 0 OR LOCATE(?, COALESCE(nit, '')) > 0 OR LOCATE(?, COALESCE(contacto_nombre, '')) > 0)
    ORDER BY nombre_comercial, id`, [empresaId, buscar, buscar, buscar, buscar, buscar])).map(mapear);
}

export async function obtenerProveedorRrhh(empresaId: number, id: number): Promise<ProveedorRrhh | null> {
  const rows = await query<RowDataPacket[]>(`SELECT ${columnas} FROM rrhh_proveedores WHERE empresa_id = ? AND id = ?`, [empresaId, id]);
  return rows[0] ? mapear(rows[0]) : null;
}

export async function guardarProveedorRrhh(empresaId: number, usuarioId: number, usuario: string, datos: Partial<ProveedorRrhhDatos>, id?: number): Promise<number | null> {
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    let antes: ProveedorRrhh | null = null;
    if (id !== undefined) {
      const [rows] = await conn.query<RowDataPacket[]>(`SELECT ${columnas} FROM rrhh_proveedores WHERE empresa_id = ? AND id = ? FOR UPDATE`, [empresaId, id]);
      if (!rows[0]) { await conn.rollback(); return null; }
      antes = mapear(rows[0]);
    }
    const despues = Object.fromEntries(camposProveedorRrhh.map(c => [c, datos[c] !== undefined ? datos[c] : antes ? antes[c] : c === "activo" ? true : null])) as ProveedorRrhhDatos;
    if (id === undefined) {
      const [result] = await conn.execute<ResultSetHeader>(`INSERT INTO rrhh_proveedores
        (empresa_id, ${camposProveedorRrhh.join(", ")}, creado_por, actualizado_por)
        VALUES (${Array(camposProveedorRrhh.length + 3).fill("?").join(", ")})`,
      [empresaId, ...camposProveedorRrhh.map(c => despues[c]), usuarioId, usuarioId]);
      id = result.insertId;
    } else {
      const campos = camposProveedorRrhh.filter(c => datos[c] !== undefined);
      await conn.execute(`UPDATE rrhh_proveedores SET ${campos.map(c => `${c} = ?`).join(", ")}, actualizado_por = ? WHERE empresa_id = ? AND id = ?`,
        [...campos.map(c => despues[c]), usuarioId, empresaId, id]);
    }
    const accion = !antes ? "crear_proveedor_rrhh" : antes.activo !== despues.activo
      ? despues.activo ? "reactivar_proveedor_rrhh" : "inactivar_proveedor_rrhh" : "editar_proveedor_rrhh";
    // No replicar cuenta bancaria/correo/teléfono/dirección en auditoría — mismo criterio que Compras.
    const resumen = (p: ProveedorRrhhDatos) => ({ nombre_comercial: p.nombre_comercial, razon_social: p.razon_social, nit: p.nit, activo: p.activo, metodo_pago_habitual: p.metodo_pago_habitual, dias_credito: p.dias_credito });
    await registrarAuditoriaTx(conn, { empresaId, usuario, accion, modulo: "rrhh_proveedores",
      detalle: JSON.stringify({ proveedorId: id, usuarioId, campos: Object.keys(datos), antes: antes ? resumen(antes) : null, despues: resumen(despues) }) });
    await conn.commit();
    return id;
  } catch (error) { await conn.rollback(); throw error; }
  finally { conn.release(); }
}
