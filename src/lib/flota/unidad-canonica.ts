import type { PoolConnection,RowDataPacket } from "mysql2/promise";
import { ErrorCB2 } from "./cb2/model";
import { rows } from "./cb2/repository";
import { catalogoSinAlias } from "./vehiculos-alias";
import { estadoEsquemaFisico,consultaFisicaTx } from "./identidad-fisica-schema";
/** El maestro físico es global; el representante operativo conserva el ámbito de empresa.
 * Leer equivalencias nunca concede acceso ni mueve referencias históricas. */
export async function resolverUnidadCanonica(c:PoolConnection,empresa:number,id:number,operativa=false) {
 const acceso="(v.empresa_id=? OR EXISTS(SELECT 1 FROM flota_vehiculo_acceso a WHERE a.vehiculo_id=v.id AND a.empresa_id=?))";
 let [origen]=await rows(c,`SELECT v.id,v.empresa_id,v.placa,v.activo,v.estado FROM flota_vehiculos v WHERE v.id=? AND ${acceso}`,[id,empresa,empresa]);
 if(!origen && !operativa) {
  // Una revocación de acceso operativo no elimina la historia propia.
  const fuentes=await rows(c,"SELECT TABLE_NAME,COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('flota_cb2_consumos','flota_viajes','tms_solicitud_fondo_lineas','tms_unidades','flota_mantenimientos','flota_multas','flota_documentos') AND COLUMN_NAME IN ('empresa_id','vehiculo_id','flota_vehiculo_id')");
  for(const tabla of [...new Set(fuentes.map(f=>String(f.TABLE_NAME)))]) {
   if(!fuentes.some(f=>f.TABLE_NAME===tabla&&f.COLUMN_NAME==='empresa_id'))continue;
   const campo=fuentes.find(f=>f.TABLE_NAME===tabla&&f.COLUMN_NAME!=='empresa_id')?.COLUMN_NAME;if(!campo)continue;
   const [propia]=await rows(c,`SELECT 1 prueba FROM \`${tabla}\` WHERE empresa_id=? AND \`${campo}\`=? LIMIT 1`,[empresa,id]);
   if(propia){[origen]=await rows(c,"SELECT id,empresa_id,placa,activo,estado FROM flota_vehiculos WHERE id=?",[id]);break;}
  }
 }
 if(!origen)throw new ErrorCB2("Unidad no disponible en esta empresa.",404);
 const existeAlias=await rows(c,"SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='flota_vehiculos_fusiones'");
 const ids=new Set<number>([id]);
 const aliases=existeAlias.length?await rows(c,"SELECT origen_id,destino_id FROM flota_vehiculos_fusiones WHERE origen_id=? OR destino_id=?",[id,id]):[];
 for(const a of aliases){ids.add(Number(a.origen_id));ids.add(Number(a.destino_id));}
 const estado=await estadoEsquemaFisico(consultaFisicaTx(c));if(estado==="PARCIAL")throw new ErrorCB2("Identidad física parcialmente instalada; revisar postcheck.",503);
 let fisica:number|null=null;
 if(estado==="COMPLETO"){
  const grupo=await rows(c,`SELECT m.vehiculo_id,m.identidad_id FROM flota_identidad_miembros m JOIN flota_identidades_fisicas f ON f.id=m.identidad_id AND f.estado='APROBADA' WHERE m.identidad_id IN (SELECT z.identidad_id FROM flota_identidad_miembros z WHERE z.vehiculo_id IN (${[...ids].map(()=>'?').join(',')})) ORDER BY m.vehiculo_id`,[...ids]);
  const grupos=new Set(grupo.map(r=>Number(r.identidad_id)));if(grupos.size>1)throw new ErrorCB2("Equivalencias contradictorias; revisión manual requerida.");
  fisica=grupo[0]?Number(grupo[0].identidad_id):null;for(const m of grupo)ids.add(Number(m.vehiculo_id));
 }
 if(existeAlias.length){const marks=[...ids].map(()=>'?').join(',');const anteriores=await rows(c,`SELECT origen_id,destino_id FROM flota_vehiculos_fusiones WHERE destino_id IN (${marks})`,[...ids]);for(const a of anteriores)ids.add(Number(a.origen_id));}
 const registros=await rows(c,`SELECT v.id,v.empresa_id,v.placa,v.activo,v.estado FROM flota_vehiculos v WHERE v.id IN (${[...ids].map(()=>'?').join(',')}) AND ${acceso} ORDER BY v.id`,[...ids,empresa,empresa]);
 const activos=registros.filter(v=>Number(v.activo)===1&&v.estado==='Activo');
 const disponibles=await catalogoSinAlias<RowDataPacket & {id:number}>(activos.map(v=>({...v,id:Number(v.id)})),empresa,(sql,p=[])=>rows(c,sql,p));
 const canon=disponibles.sort((a,b)=>Number(Number(b.empresa_id)===empresa)-Number(Number(a.empresa_id)===empresa)||a.id-b.id)[0];
 if(!canon&&operativa)throw new ErrorCB2("No hay representante canónico activo con acceso vigente.",403);
 return {solicitadoId:id,identidadCanonica:fisica?`FISICA:${fisica}`:`FLOTA:${canon?.id??id}`,identidadFisicaId:fisica,vehiculoCanonicoId:canon?.id??null,placa:canon?.placa??String(origen.placa),idsHistoricos:[...ids].sort((a,b)=>a-b),empresaId:empresa};
}
export type UnidadCanonica=Awaited<ReturnType<typeof resolverUnidadCanonica>>;
/** Inventario íntegro de FK directas y referencias operativas convencionales; no datos ajenos. */
export async function historialUnidadCanonica(c:PoolConnection,empresa:number,id:number,fuente?:string,despues=0) {
 const unidad=await resolverUnidadCanonica(c,empresa,id);
 const columnas=await rows(c,"SELECT c.TABLE_NAME,c.COLUMN_NAME,c.DATA_TYPE,t.ENGINE,t.TABLE_TYPE FROM information_schema.COLUMNS c JOIN information_schema.TABLES t ON t.TABLE_SCHEMA=c.TABLE_SCHEMA AND t.TABLE_NAME=c.TABLE_NAME WHERE c.TABLE_SCHEMA=DATABASE() ORDER BY c.TABLE_NAME,c.ORDINAL_POSITION");
 const fks=await rows(c,"SELECT TABLE_NAME,COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND REFERENCED_TABLE_SCHEMA=DATABASE() AND REFERENCED_TABLE_NAME='flota_vehiculos' AND REFERENCED_COLUMN_NAME='id'");
 const tablas=new Map<string,RowDataPacket[]>();for(const r of columnas){const t=String(r.TABLE_NAME);tablas.set(t,[...(tablas.get(t)??[]),r]);}
 const fuentes:Record<string,unknown>[]=[];let items:RowDataPacket[]=[];let siguiente:number|null=null;
 const quote=(v:string)=>{if(!/^[a-zA-Z0-9_]+$/.test(v))throw new ErrorCB2("Inventario SQL no verificable.",503);return '`'+v+'`';};
 for(const [tabla,cols] of tablas){
  if(tabla==='flota_vehiculos')continue;
  const campos=cols.map(r=>String(r.COLUMN_NAME));
  const refs=campos.filter(k=>/(^|_)vehiculo(_.*)?_id$/.test(k)||k==='vehiculo_id'||k==='unidad_recurrente_id'||fks.some(f=>f.TABLE_NAME===tabla&&f.COLUMN_NAME===k));
  const tms=tabla==='tms_planes_viaje'&&campos.includes('unidad_id');
  const json:Record<string,Record<string,string[]>>={flota_cb2_filas:{decision:['$.vehiculoId','$.asignacion.vehiculoId','$.vehiculoSolicitadoId']},flota_cb2_asignaciones:{anterior:['$.vehiculoId'],nuevo:['$.vehiculoId']},auditoria:{detalle:['$.vehiculoId','$.origenId','$.destinoId']}};
  const snapshots=Object.entries(json[tabla]??{}).filter(([campo])=>campos.includes(campo));
  if(!refs.length&&!tms&&!snapshots.length)continue;
  if(!campos.includes('empresa_id')){fuentes.push({tabla:"Referencias sin ámbito empresarial directo",consultable:false});continue;}
  if(cols[0].ENGINE!=='InnoDB'||cols[0].TABLE_TYPE!=='BASE TABLE')throw new ErrorCB2("Fuente histórica no transaccional; revisar preflight.",503);
  // Los snapshots JSON pueden necesitar un scan: solo tras elegir expresamente esa fuente.
  if(!refs.length&&!tms&&snapshots.length&&fuente!==tabla){fuentes.push({tabla,consultable:campos.includes('id'),revisionManual:"Consulta explícita de snapshots; sin barrido inicial"});continue;}
  const args:(number|string)[]=[empresa],predicados:string[]=[];
  for(const k of refs){predicados.push(`${quote(k)} IN (${unidad.idsHistoricos.map(()=>'?').join(',')})`);args.push(...unidad.idsHistoricos);}
  if(tms){predicados.push(`unidad_id IN(SELECT id FROM tms_unidades WHERE empresa_id=? AND flota_vehiculo_id IN (${unidad.idsHistoricos.map(()=>'?').join(',')}))`);args.push(empresa,...unidad.idsHistoricos);}
  for(const [campo,rutas] of snapshots)for(const ruta of rutas){const valor=`JSON_VALUE(CASE WHEN JSON_VALID(${quote(campo)}) THEN ${quote(campo)} ELSE '{}' END,'${ruta}')`;predicados.push(`(CASE WHEN ${valor} REGEXP '^[0-9]+$' THEN CAST(${valor} AS UNSIGNED) ELSE NULL END) IN (${unidad.idsHistoricos.map(()=>'?').join(',')})`);args.push(...unidad.idsHistoricos);}
  const where=`empresa_id=? AND (${predicados.join(' OR ')})`;
  const [total]=await rows(c,`SELECT COUNT(*) cantidad FROM ${quote(tabla)} WHERE ${where}`,args);
  const gruposTotales=campos.filter(k=>["moneda","producto_clasificado","producto"].includes(k));
  const sumas=campos.filter(k=>['monto','galones'].includes(k)&&cols.some(r=>r.COLUMN_NAME===k&&['decimal','int','bigint','double','float'].includes(String(r.DATA_TYPE))));
  let totales:RowDataPacket[]=[];if(sumas.length)totales=await rows(c,`SELECT ${gruposTotales.length?gruposTotales.map(quote).join(',')+',':"'NO_DECLARADA' moneda,"}${sumas.map(k=>`SUM(${quote(k)}) ${quote(k)}`).join(',')} FROM ${quote(tabla)} WHERE ${where}${gruposTotales.length?' GROUP BY '+gruposTotales.map(quote).join(','):''}`,args);
  fuentes.push({tabla,consultable:campos.includes('id'),cantidad:Number(total.cantidad),totales});
  if(fuente===tabla){if(!campos.includes('id'))throw new ErrorCB2("Esta fuente solo permite conteos, no paginación por ID.",400);
   const visibles=campos.filter(k=>['id','empresa_id','vehiculo_id','tc_vehiculo_id','flota_vehiculo_id','unidad_id','fecha','fecha_consumo','fecha_plan','estado','numero_vale','producto','galones','monto','moneda','solicitud_id','plan_id'].includes(k));
   items=await rows(c,`SELECT ${visibles.map(quote).join(',')} FROM ${quote(tabla)} WHERE ${where} AND id>? ORDER BY id LIMIT 101`,[...args,despues]);if(items.length>100){items=items.slice(0,100);siguiente=Number(items.at(-1)!.id);}
  }
 }
 if(fuente&&!fuentes.some(f=>f.tabla===fuente&&f.consultable))throw new ErrorCB2("Fuente no consultable en este ámbito.",400);
 return {unidad,fuentes,items,siguiente,historicosReasignados:0};
}
