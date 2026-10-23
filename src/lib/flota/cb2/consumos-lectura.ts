import type { PoolConnection } from "mysql2/promise";
import { rows } from "./repository";
import type { FiltrosCB2 } from "./service";
export async function consultarConsumos(c: PoolConnection, empresa: number, limite: number, despues: number, filtros: FiltrosCB2) {
    const where = ["c.empresa_id=?", "c.id>?"], args: (string | number)[] = [empresa, despues];
    for (const [campo, valor] of [["proveedor_id", filtros.proveedorId], ["vehiculo_id", filtros.vehiculoId], ["empleado_id", filtros.empleadoId], ["importacion_origen_id", filtros.importacionId], ["producto_clasificado", filtros.producto], ["estado_factura", filtros.estado]] as const) if (valor !== undefined) { where.push(campo === "producto_clasificado" ? "COALESCE(c.producto_clasificado,'NO_DETERMINADO')=?" : `c.${campo}=?`); args.push(valor); }
    if (filtros.desde) { where.push("c.fecha_consumo>=?"); args.push(filtros.desde); }
    if (filtros.hasta) { where.push("c.fecha_consumo<=?"); args.push(filtros.hasta); }
    if (filtros.buscar) { where.push("(LOCATE(UPPER(?),UPPER(c.vale_norm))>0 OR LOCATE(UPPER(?),UPPER(c.placa_normalizada))>0 OR LOCATE(UPPER(?),UPPER(i.archivo_nombre))>0)"); args.push(filtros.buscar, filtros.buscar, filtros.buscar); }
    return rows(c, `SELECT c.*,v.placa AS unidad_placa,e.nombre AS empleado_nombre,i.perfil,i.archivo_nombre,i.creado_en AS importado_en,i.creado_por AS importado_por,u.username AS importado_usuario,i.proveedor_nombre,f.serie AS factura_serie,f.numero AS factura_numero,
      (SELECT JSON_ARRAYAGG(JSON_OBJECT('hoja',o.hoja_nombre,'fila',o.fila_excel,'lote',JSON_EXTRACT(o.datos_origen,'$.lote'),'piloto',JSON_EXTRACT(o.datos_origen,'$.textos.piloto'),'producto',JSON_EXTRACT(o.datos_origen,'$.textos.producto'),'motivos',JSON_EXTRACT(o.datos_origen,'$.motivos')) ORDER BY o.id LIMIT 25) FROM flota_cb2_filas o WHERE o.empresa_id=c.empresa_id AND o.proveedor_id=c.proveedor_id AND o.importacion_id=c.importacion_origen_id AND o.tipo='ORIGEN' AND EXISTS (SELECT 1 FROM flota_cb2_filas ev WHERE ev.empresa_id=o.empresa_id AND ev.importacion_id=o.importacion_id AND COALESCE(ev.origen_fila_id,ev.id)=o.id AND ev.consumo_id=c.id)) AS origenes,
      (SELECT JSON_ARRAYAGG(JSON_OBJECT('anterior',a.anterior,'nuevo',a.nuevo,'motivo',a.motivo,'usuario',a.usuario_id,'fecha',a.creado_en)) FROM flota_cb2_asignaciones a WHERE a.empresa_id=c.empresa_id AND a.proveedor_id=c.proveedor_id AND a.consumo_id=c.id) AS correcciones
      FROM flota_cb2_consumos c JOIN flota_cb2_importaciones i ON i.empresa_id=c.empresa_id AND i.proveedor_id=c.proveedor_id AND i.id=c.importacion_origen_id
      LEFT JOIN usuarios u ON u.id=i.creado_por
      JOIN flota_vehiculos v ON v.id=c.vehiculo_id
      LEFT JOIN empleados e ON e.id=c.empleado_id AND e.empresa_id=c.empresa_id
      LEFT JOIN flota_cb2_facturas f ON f.id=c.factura_id AND f.empresa_id=c.empresa_id AND f.proveedor_id=c.proveedor_id
      WHERE ${where.join(" AND ")} ORDER BY c.id LIMIT ?`, [...args, limite]);
}
