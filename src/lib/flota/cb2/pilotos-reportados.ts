import { query,type SqlValue } from "@/lib/db";
import type { RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import { hash,ErrorCB2 } from "./model";
import { rows,type Contexto } from "./repository";
import { ahoraLocal } from "@/lib/rrhh/dates";
import { normalizarNombreReportado,proponerNombre,type DecisionNombre,type RevisionNombre } from "./pilotos-nombres";
export { normalizarNombreReportado } from "./pilotos-nombres";
export async function esquemaPilotosReportados(c?:PoolConnection) {
 const leer=(sql:string)=>c?rows(c,sql):query<RowDataPacket[]>(sql,[] as SqlValue[]);
 const tablas=await leer("SELECT TABLE_NAME,ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('flota_cb2_pilotos_reportados','flota_cb2_consumo_piloto_reportado','flota_cb2_pilotos_equivalencias')");
 if(!tablas.length)return false;
 if(tablas.length!==3 || tablas.some(t=>t.ENGINE!=="InnoDB"))throw new ErrorCB2("Registro de pilotos reportados parcialmente instalado; revisar preflight.",503);
 const [guardas]=await leer("SELECT COUNT(*) n FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME IN ('flota_cb2_pilotos_reportados','flota_cb2_consumo_piloto_reportado','flota_cb2_pilotos_equivalencias') AND CONSTRAINT_NAME IN ('fk_cb2pr_empresa','fk_cb2pr_actor','ck_cb2pr_version','ck_cb2pr_estado','ck_cb2pr_nombre','fk_cb2cpr_consumo','fk_cb2cpr_piloto','fk_cb2pe_empresa','fk_cb2pe_empleado','fk_cb2pe_reportado','fk_cb2pe_actor','ck_cb2pe_version','ck_cb2pe_destino','ck_cb2pe_nombre','ck_cb2pe_revision')");
 if(Number(guardas?.n)!==15)throw new ErrorCB2("Faltan guardas del registro de nombres reportados.",503);
 const indices=await leer("SELECT TABLE_NAME,INDEX_NAME,GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) columnas,MAX(NON_UNIQUE) no_unico,SUM(SUB_PART IS NOT NULL) prefijos FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND ((TABLE_NAME='flota_cb2_pilotos_reportados' AND INDEX_NAME IN ('uq_cb2pr_nombre','uq_cb2pr_ambito')) OR (TABLE_NAME='flota_cb2_consumo_piloto_reportado' AND INDEX_NAME='PRIMARY') OR (TABLE_NAME='flota_cb2_pilotos_equivalencias' AND INDEX_NAME='PRIMARY')) GROUP BY TABLE_NAME,INDEX_NAME");
 const requeridos:Record<string,string>={uq_cb2pr_nombre:"empresa_id,normalizacion_version,nombre_hash",uq_cb2pr_ambito:"empresa_id,id",PRIMARY:"empresa_id,proveedor_id,consumo_id"};
 if(indices.length!==4 || indices.some(i=>Number(i.no_unico)!==0||Number(i.prefijos)!==0||i.columnas!==(i.TABLE_NAME==="flota_cb2_pilotos_equivalencias"?"empresa_id,normalizacion_version,nombre_hash":requeridos[String(i.INDEX_NAME)])))throw new ErrorCB2("Índices de nombres reportados incompatibles.",503);
 return true;
}
export async function revisarNombresTx(c:PoolConnection,empresa:number,nombres:string[],instalado:boolean):Promise<RevisionNombre[]> {
 const empleados=(await rows(c,"SELECT id,nombre FROM empleados WHERE empresa_id=? AND estado='Activo' ORDER BY id",[empresa])).map(p=>({id:Number(p.id),nombre:String(p.nombre)}));
 const grupos=new Map<string,RevisionNombre>();
 for(const nombre of nombres) {
  const clave=normalizarNombreReportado(nombre);if(!clave)continue;
  const previo=grupos.get(clave);if(previo){previo.filas++;if(!previo.originales.includes(nombre))previo.originales.push(nombre);continue;}
  const [alias]=instalado?await rows(c,"SELECT nombre_normalizado,empleado_id,piloto_reportado_id,requiere_revision FROM flota_cb2_pilotos_equivalencias WHERE empresa_id=? AND normalizacion_version=1 AND nombre_hash=?",[empresa,hash(clave)]):[];
  if(alias && alias.nombre_normalizado!==clave)throw new ErrorCB2("Colisión de nombre; requiere revisión.");
  const destino:DecisionNombre|undefined=alias?alias.empleado_id!=null?{tipo:"EMPLEADO",empleadoId:Number(alias.empleado_id),confirmado:false}:{tipo:"REPORTADO",reportadoId:Number(alias.piloto_reportado_id),confirmado:false}:undefined;
  const revision=proponerNombre(nombre,empleados,destino);if(Number(alias?.requiere_revision)===1)revision.propuesta=null;grupos.set(clave,revision);
 }
 return [...grupos.values()];
}
const mismoDestino=(a:DecisionNombre|undefined|null,b:DecisionNombre)=>!!a && a.tipo===b.tipo && (a.tipo==="EMPLEADO" ? b.tipo==="EMPLEADO" && a.empleadoId===b.empleadoId : b.tipo==="REPORTADO" && a.reportadoId===b.reportadoId);
/** Solo dentro de confirmar/reanudar. La vista previa no invoca este escritor. */
async function resolverNombreTx(c:PoolConnection,ctx:Contexto,nombre:string|null,decision?:DecisionNombre) {
 const normalizado=normalizarNombreReportado(nombre??"");if(!normalizado || !decision)return null;
 if(normalizado.length>768)throw new ErrorCB2("Nombre reportado excede el límite normalizado.",400);
 const digest=hash(normalizado);
 // Serializa decisiones entre proveedores; revalida después de esperar este bloqueo.
 await rows(c,"SELECT id FROM empresas WHERE id=? FOR UPDATE",[ctx.empresaId]);
 const [revision]=await revisarNombresTx(c,ctx.empresaId,[nombre!],true);
 // Un alta concurrente idéntica es un reintento compatible, sin confiar en insertId.
 const altaConcurrente=decision.tipo==="REPORTADO" && decision.reportadoId==null && decision.confirmado && revision.equivalencia?.tipo==="REPORTADO";
 if(!decision.confirmado && !mismoDestino(revision.propuesta,decision))throw new ErrorCB2("El nombre requiere confirmación; revisa las coincidencias actuales.");
 if(revision.equivalencia && !mismoDestino(revision.equivalencia,decision) && !altaConcurrente){if(!decision.confirmado)throw new ErrorCB2("Equivalencia ambigua: confirma la identidad para este archivo.");await c.execute("UPDATE flota_cb2_pilotos_equivalencias SET requiere_revision=1 WHERE empresa_id=? AND normalizacion_version=1 AND nombre_hash=?",[ctx.empresaId,digest]);}
 let reportado=decision.tipo==="REPORTADO"?decision.reportadoId??(altaConcurrente && revision.equivalencia?.tipo==="REPORTADO"?revision.equivalencia.reportadoId:null)??null:null;
 if(decision.tipo==="EMPLEADO") {
  const [e]=await rows(c,"SELECT id FROM empleados WHERE empresa_id=? AND id=? AND estado='Activo' LOCK IN SHARE MODE",[ctx.empresaId,decision.empleadoId]);
  if(!e)throw new ErrorCB2("Empleado no autorizado para esta empresa.",403);
 } else if(reportado!=null) {
  const [p]=await rows(c,"SELECT id FROM flota_cb2_pilotos_reportados WHERE empresa_id=? AND id=? AND estado='REPORTADO_CONFIRMADO' AND nombre_hash=? AND nombre_normalizado=? LOCK IN SHARE MODE",[ctx.empresaId,reportado,digest,normalizado]);
  if(!p || (!decision.confirmado && !altaConcurrente && !mismoDestino(revision.equivalencia,decision)))throw new ErrorCB2("Identidad reportada no confirmada para este nombre.",403);
 } else {
  if(!decision.confirmado)throw new ErrorCB2("Confirma guardar el piloto reportado.");
  await c.execute("INSERT INTO flota_cb2_pilotos_reportados(empresa_id,nombre_normalizado,nombre_hash,nombre_muestra,creado_por,creado_en) VALUES(?,?,?,?,?,?) ON DUPLICATE KEY UPDATE id=id",[ctx.empresaId,normalizado,digest,nombre!,ctx.actor.id,ahoraLocal()]);
  const [p]=await rows(c,"SELECT id,nombre_normalizado,estado FROM flota_cb2_pilotos_reportados WHERE empresa_id=? AND normalizacion_version=1 AND nombre_hash=? FOR UPDATE",[ctx.empresaId,digest]);
  if(!p || p.nombre_normalizado!==normalizado || p.estado!=="REPORTADO_CONFIRMADO")throw new ErrorCB2("Registro reportado incompatible.");
  reportado=Number(p.id);
 }
 // La propuesta automática exacta no se convierte en equivalencia confirmada.
 if(decision.confirmado) {
  await c.execute("INSERT INTO flota_cb2_pilotos_equivalencias(empresa_id,nombre_hash,nombre_normalizado,empleado_id,piloto_reportado_id,confirmado_por,confirmado_en) VALUES(?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE nombre_hash=nombre_hash",[ctx.empresaId,digest,normalizado,decision.tipo==="EMPLEADO"?decision.empleadoId:null,reportado,ctx.actor.id,ahoraLocal()]);
 }
 return reportado;
}

export async function registrarPilotoReportadoTx(c:PoolConnection,ctx:Contexto,consumoId:number,nombre:string|null,decision:DecisionNombre,cache=new Map<string,number|null>()) {
 const key=normalizarNombreReportado(nombre??"");
 const reportado=cache.has(key)?cache.get(key)!:await resolverNombreTx(c,ctx,nombre,decision);
 cache.set(key,reportado);
 if(reportado!=null) {
  await c.execute("INSERT INTO flota_cb2_consumo_piloto_reportado(empresa_id,proveedor_id,consumo_id,piloto_reportado_id) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE consumo_id=consumo_id",[ctx.empresaId,ctx.proveedorId,consumoId,reportado]);
  const [v]=await rows(c,"SELECT piloto_reportado_id FROM flota_cb2_consumo_piloto_reportado WHERE empresa_id=? AND proveedor_id=? AND consumo_id=?",[ctx.empresaId,ctx.proveedorId,consumoId]);
  if(Number(v?.piloto_reportado_id)!==reportado)throw new ErrorCB2("El consumo ya tiene otra identidad reportada; no se sobrescribe.");
 }
 return reportado;
}
