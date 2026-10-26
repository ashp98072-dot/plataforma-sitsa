import type { RowDataPacket } from "mysql2/promise";
import { getPool } from "@/lib/db";
import { rows } from "./repository";
import { balanceDocumental, DecimalDocumental, TOLERANCIA_DOCUMENTAL, type EstadoDocumental, type FacturaDocumental, type ConsumoDocumental, type PaginaDocumental } from "./conciliacion-documental-model";

export type FiltrosDocumentales = { proveedorId?: number; desde?: string; hasta?: string; fecha?: "TODAS" | "CON_FECHA" | "SIN_FECHA"; estado?: EstadoDocumental; buscar?: string };
// SUM de columnas DECIMAL en MariaDB conserva precisión exacta; nunca FLOAT/DOUBLE.
// Una fila por factura/moneda antes de paginar o filtrar por estado. No une evidencia.
const agregado = `SELECT f.id,f.proveedor_id,p.nombre_comercial AS proveedor,f.serie,f.numero,
 DATE_FORMAT(f.fecha_factura,'%Y-%m-%d') AS fecha,f.moneda,f.total_documental,
 COUNT(c.id) AS cantidad,COALESCE(SUM(c.galones),0) AS galones,COALESCE(SUM(c.monto),0) AS monto
 FROM flota_cb2_facturas f
 JOIN compras_proveedores p ON p.empresa_id=f.empresa_id AND p.id=f.proveedor_id
 LEFT JOIN flota_cb2_consumos c ON c.empresa_id=f.empresa_id AND c.proveedor_id=f.proveedor_id AND c.factura_id=f.id AND c.moneda=f.moneda`;
// Mismo orden y tolerancia que balanceDocumental; SQL decimal exacto permite
// aplicar estado ANTES de LIMIT, sin cargar todas las facturas al servidor/browser.
const estadoSql = `CASE WHEN a.total_documental IS NULL THEN 'SIN_TOTAL_DOCUMENTAL'
 WHEN a.cantidad=0 THEN 'SIN_CONSUMOS'
 WHEN ABS(a.total_documental-a.monto)<=${TOLERANCIA_DOCUMENTAL} THEN 'CUADRADA' ELSE 'CON_DIFERENCIA' END`;
function factura(r: RowDataPacket): FacturaDocumental {
    const total = r.total_documental === null ? null : new DecimalDocumental(String(r.total_documental)).toFixed();
    return { id: Number(r.id), proveedorId: Number(r.proveedor_id), proveedor: String(r.proveedor), serie: String(r.serie), numero: String(r.numero),
        fecha: r.fecha == null ? null : String(r.fecha), moneda: String(r.moneda), totalDocumental: total, cantidad: Number(r.cantidad),
        ...balanceDocumental(total, Number(r.cantidad), String(r.monto), String(r.galones)) };
}
export async function consultarDocumental(empresa: number, filtros: FiltrosDocumentales, limite: number, despues: number): Promise<PaginaDocumental<FacturaDocumental>> {
    const where = ["f.empresa_id=?", "f.id>?"], args: (string | number)[] = [empresa, despues];
    if (filtros.proveedorId) { where.push("f.proveedor_id=?"); args.push(filtros.proveedorId); }
    if (filtros.fecha === "SIN_FECHA") where.push("f.fecha_factura IS NULL");
    else {
        if (filtros.fecha === "CON_FECHA") where.push("f.fecha_factura IS NOT NULL");
        if (filtros.desde) { where.push("f.fecha_factura>=?"); args.push(filtros.desde); }
        if (filtros.hasta) { where.push("f.fecha_factura<=?"); args.push(filtros.hasta); }
    }
    if (filtros.buscar) { where.push("(LOCATE(UPPER(?),f.serie_norm)>0 OR LOCATE(UPPER(?),f.numero_norm)>0)"); args.push(filtros.buscar, filtros.buscar); }
    const sql = `SELECT a.* FROM (${agregado} WHERE ${where.join(" AND ")}
 GROUP BY f.empresa_id,f.id,f.proveedor_id,p.nombre_comercial,f.serie,f.numero,f.fecha_factura,f.moneda,f.total_documental) a
 ${filtros.estado ? `WHERE ${estadoSql}=?` : ""} ORDER BY a.id LIMIT ?`;
    if (filtros.estado) args.push(filtros.estado);
    const c = await getPool().getConnection();
    try {
        const result = await rows(c, sql, [...args, limite + 1]);
        return { filas: result.slice(0, limite).map(factura), siguiente: result.length > limite ? Number(result[limite - 1].id) : null };
    } finally { c.release(); }
}
export async function consumosDocumentales(empresa: number, proveedor: number, facturaId: number, limite: number, despues: number): Promise<PaginaDocumental<ConsumoDocumental>> {
    const c = await getPool().getConnection();
    try {
        const result = await rows(c, `SELECT c.id,c.importacion_origen_id,c.numero_vale,c.placa_original,DATE_FORMAT(c.fecha_consumo,'%Y-%m-%d') AS fecha,c.moneda,c.galones,c.monto
 FROM flota_cb2_facturas f JOIN flota_cb2_consumos c ON c.empresa_id=f.empresa_id AND c.proveedor_id=f.proveedor_id AND c.factura_id=f.id AND c.moneda=f.moneda
 WHERE f.empresa_id=? AND f.proveedor_id=? AND f.id=? AND c.id>? ORDER BY c.id LIMIT ?`, [empresa, proveedor, facturaId, despues, limite + 1]);
        return { filas: result.slice(0, limite).map(r => ({ id: Number(r.id), importacionId: Number(r.importacion_origen_id), vale: String(r.numero_vale), placa: String(r.placa_original), fecha: String(r.fecha), moneda: String(r.moneda), galones: new DecimalDocumental(String(r.galones)).toFixed(), monto: new DecimalDocumental(String(r.monto)).toFixed() })), siguiente: result.length > limite ? Number(result[limite - 1].id) : null };
    } finally { c.release(); }
}
