import { z } from "zod";
import { getPool, type SqlValue } from "@/lib/db";
import { rows } from "./repository";
import { ErrorCB2, id } from "./model";

export const filtrosHistorial = z.object({ desde: z.iso.date().optional(), hasta: z.iso.date().optional(), piloto: z.string().trim().max(160).optional(), proveedorId: id.optional() }).strict();
export const cursorHistorial = z.object({ corte: z.number().int().nonnegative(), fecha: z.iso.date(), id: id }).strict();
export type FiltrosHistorial = z.infer<typeof filtrosHistorial>;
export type CursorHistorial = z.infer<typeof cursorHistorial>;

/** Keyset ordenado por fecha e ID descendentes; el corte excluye IDs nuevos, no es una instantánea. */
export async function historialConsumos(empresa: number, filtros: FiltrosHistorial, cursor?: CursorHistorial, limite = 50) {
 if (filtros.desde && filtros.hasta && filtros.desde > filtros.hasta) throw new ErrorCB2("Rango de fechas inválido.", 400);
 const c = await getPool().getConnection();
 try {
  await c.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ"); await c.beginTransaction();
  const corte = cursor?.corte ?? Number((await rows(c, "SELECT COALESCE(MAX(id),0) AS corte FROM flota_cb2_consumos WHERE empresa_id=?", [empresa]))[0].corte);
  const where = ["c.empresa_id=?", "c.id<=?"], args: SqlValue[] = [empresa, corte];
  if (filtros.desde) { where.push("c.fecha_consumo>=?"); args.push(filtros.desde); }
  if (filtros.hasta) { where.push("c.fecha_consumo<=?"); args.push(filtros.hasta); }
  if (filtros.piloto) { where.push("LOCATE(UPPER(?),UPPER(COALESCE(c.piloto_informado,'')))>0"); args.push(filtros.piloto); }
  if (filtros.proveedorId) { where.push("c.proveedor_id=?"); args.push(filtros.proveedorId); }
  if (cursor) { where.push("(c.fecha_consumo<? OR (c.fecha_consumo=? AND c.id<?))"); args.push(cursor.fecha, cursor.fecha, cursor.id); }
  const data = await rows(c, `SELECT c.id,DATE_FORMAT(c.fecha_consumo,'%Y-%m-%d') AS fecha,c.piloto_informado,c.empleado_id,e.nombre AS empleado_nombre,c.vehiculo_id,c.unidad_externa_id,c.placa_original,COALESCE(v.placa,c.placa_original) AS unidad_placa,c.proveedor_id,p.nombre_comercial AS proveedor,c.numero_vale,c.producto,c.producto_clasificado,c.galones,c.precio,c.monto,c.moneda,c.factura_id,c.estado_factura,f.serie AS factura_serie,f.numero AS factura_numero,c.importacion_origen_id,i.archivo_nombre,i.perfil
 FROM flota_cb2_consumos c JOIN flota_cb2_importaciones i ON i.empresa_id=c.empresa_id AND i.proveedor_id=c.proveedor_id AND i.id=c.importacion_origen_id
 JOIN compras_proveedores p ON p.empresa_id=c.empresa_id AND p.id=c.proveedor_id
 LEFT JOIN flota_vehiculos v ON v.id=c.vehiculo_id LEFT JOIN empleados e ON e.empresa_id=c.empresa_id AND e.id=c.empleado_id
 LEFT JOIN flota_cb2_facturas f ON f.empresa_id=c.empresa_id AND f.proveedor_id=c.proveedor_id AND f.id=c.factura_id
 WHERE ${where.join(" AND ")} ORDER BY c.fecha_consumo DESC,c.id DESC LIMIT ?`, [...args, limite + 1]);
  const items = data.slice(0, limite), ultimo = items.at(-1);
  const siguiente = data.length > limite && ultimo ? { corte, fecha: String(ultimo.fecha), id: Number(ultimo.id) } : null;
  await c.commit(); return { items, siguiente };
 } catch (error) { await c.rollback(); throw error; } finally { c.release(); }
}
