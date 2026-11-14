import { z } from "zod";
import { getPool,type SqlValue } from "@/lib/db";
import { ErrorCB2,id } from "./model";
import { rows } from "./repository";
import { esquemaPilotosReportados } from "./pilotos-reportados";
import { productos } from "./clasificacion";
export const filtrosPiloto=z.object({desde:z.iso.date().optional(),hasta:z.iso.date().optional(),proveedorId:id.optional(),pilotoReportadoId:id.optional(),empleadoId:id.optional(),pilotoExternoId:id.optional(),nombre:z.string().max(255).optional(),producto:z.enum(productos).optional()}).strict();
export type FiltrosPiloto=z.infer<typeof filtrosPiloto>;
export async function reportePilotos(empresa:number,f: FiltrosPiloto,despues=0,limite=100) {
 if(f.desde&&f.hasta&&f.desde>f.hasta)throw new ErrorCB2("Rango de fechas inválido.",400);
 const c=await getPool().getConnection();
 try{
  await c.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");await c.beginTransaction();
  const instalado=await esquemaPilotosReportados(c);
  if(f.pilotoReportadoId){if(!instalado)throw new ErrorCB2("Registro persistente no instalado.",503);const p=await rows(c,"SELECT id FROM flota_cb2_pilotos_reportados WHERE empresa_id=? AND id=?",[empresa,f.pilotoReportadoId]);if(!p.length)throw new ErrorCB2("Nombre reportado no disponible en esta empresa.",404);}
  const where=["c.empresa_id=?"],args:SqlValue[]=[empresa];
  for(const [campo,valor] of [["proveedor_id",f.proveedorId],["empleado_id",f.empleadoId],["piloto_externo_id",f.pilotoExternoId],["producto_clasificado",f.producto]] as const)if(valor!==undefined){where.push(`c.${campo}=?`);args.push(valor);}
  if(f.nombre!==undefined){where.push("BINARY c.piloto_informado=BINARY ?");args.push(f.nombre);}
  if(f.desde){where.push("c.fecha_consumo>=?");args.push(f.desde);}if(f.hasta){where.push("c.fecha_consumo<=?");args.push(f.hasta);}
  if(f.pilotoReportadoId){where.push("v.piloto_reportado_id=?");args.push(f.pilotoReportadoId);}
  const join=instalado?" LEFT JOIN flota_cb2_consumo_piloto_reportado v ON v.empresa_id=c.empresa_id AND v.proveedor_id=c.proveedor_id AND v.consumo_id=c.id":"";
  const base=`FROM flota_cb2_consumos c${join} WHERE ${where.join(" AND ")}`;
  const totales=await rows(c,`SELECT c.moneda,c.producto_clasificado,COUNT(*) consumos,SUM(c.galones) galones,SUM(c.monto) importe ${base} GROUP BY c.moneda,c.producto_clasificado ORDER BY c.moneda,c.producto_clasificado`,args);
  const items=await rows(c,`SELECT c.id,c.empresa_id,c.proveedor_id,c.numero_vale,DATE_FORMAT(c.fecha_consumo,'%Y-%m-%d') fecha,c.piloto_informado,c.vehiculo_id,c.unidad_externa_id,c.placa_original,c.producto,c.producto_clasificado,c.galones,c.precio,c.monto,c.moneda,c.empleado_id,c.piloto_externo_id,${instalado?'v.piloto_reportado_id':'NULL AS piloto_reportado_id'} ${base} AND c.id>? ORDER BY c.id LIMIT ?`,[...args,despues,limite+1]);
  const hayMas=items.length>limite;const page=items.slice(0,limite);await c.commit();
  return {instalado,advertencia:instalado?"Identidades reportadas confirmadas dentro de la empresa; no acreditan empleo ni contrato. Un nombre por sí solo no distingue homónimos.":"Persistencia no instalada. Se muestran nombres originales históricos sin inferir identidades. La importación conserva esos nombres.",items:page,totales,siguiente:hayMas?Number(page.at(-1)!.id):null};
 }catch(e){await c.rollback();throw e;}finally{c.release();}
}
export function csvPilotos(items:Record<string,unknown>[]) {
 const campos=["empresa_id","proveedor_id","fecha","numero_vale","piloto_informado","piloto_reportado_id","empleado_id","piloto_externo_id","vehiculo_id","unidad_externa_id","placa_original","producto","producto_clasificado","galones","precio","monto","moneda"];
 const celda=(v:unknown)=>{let s=String(v??"");if(/^[\s]*[=+\-@]/u.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
 return '\uFEFF'+[campos.map(celda).join(","),...items.map(r=>campos.map(k=>celda(r[k])).join(","))].join("\r\n");
}
