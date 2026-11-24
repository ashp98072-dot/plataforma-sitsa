import type { Pool, RowDataPacket } from "mysql2/promise";

/**
 * INFORMACIÓN HISTÓRICA DE SOLO LECTURA. Es el único punto de Canecas que consulta compras_proveedores y solo con SELECT,
 * para que una persona identifique a qué proveedor exclusivo de Canecas corresponde cada compra anterior. No escribe en
 * Compras, no se usa en operaciones nuevas y desaparece del flujo cuando todas las compras estén mapeadas.
 */
export async function comprasPendientesDeMapeo(pool: Pool, empresaId: number) {
  if (!Number.isSafeInteger(empresaId) || empresaId <= 0) throw new Error("HISTORICO_INVALIDO");
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT c.id,c.referencia,p.nombre AS producto,c.cantidad,c.creado_en,c.proveedor_id AS proveedor_anterior_id,
            COALESCE(ant.nombre_comercial,'(proveedor anterior no disponible)') AS proveedor_anterior
       FROM canecas_compras c JOIN canecas_productos p ON p.empresa_id=c.empresa_id AND p.id=c.producto_id
       LEFT JOIN compras_proveedores ant ON ant.empresa_id=c.empresa_id AND ant.id=c.proveedor_id
      WHERE c.empresa_id=? AND c.canecas_proveedor_id IS NULL ORDER BY c.id`, [empresaId]);
  return rows;
}

export async function mapeosRealizados(pool: Pool, empresaId: number) {
  if (!Number.isSafeInteger(empresaId) || empresaId <= 0) throw new Error("HISTORICO_INVALIDO");
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT CAST(m.id AS CHAR) AS id,c.referencia,pr.nombre_comercial AS proveedor_canecas,m.proveedor_anterior_id,us.username AS realizado_por,m.realizado_en
       FROM canecas_compras_mapeo_proveedor m JOIN canecas_compras c ON c.empresa_id=m.empresa_id AND c.id=m.compra_id
       JOIN canecas_proveedores pr ON pr.empresa_id=m.empresa_id AND pr.id=m.canecas_proveedor_id JOIN usuarios us ON us.id=m.realizado_por
      WHERE m.empresa_id=? ORDER BY m.id DESC LIMIT 500`, [empresaId]);
  return rows;
}
