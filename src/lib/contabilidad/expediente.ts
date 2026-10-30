import type {PoolConnection,RowDataPacket} from 'mysql2/promise';
import {getPool} from '@/lib/db';
import {registrarAuditoriaTx} from '@/lib/auditoria';
import {AccesoContable} from './ambito';
import {contextoTx,bloquearGestion,permisoGestion} from './politicas-autorizacion';
import {huellaCondiciones} from './regularizacion-control-contrato';
import {evidenciaEntrada,evaluarEvidencias,type Evidencia} from './expediente-contrato';
async function expedienteTx(c:PoolConnection,empresaId:number,entidadId:number,ejercicioId:number){
 const ctx=await contextoTx(c,empresaId,entidadId,ejercicioId);
 const [rows]=await c.query<RowDataPacket[]>(`SELECT *,CAST(solicitud_id AS CHAR) solicitudId,DATE_FORMAT(creado_en,'%Y-%m-%dT%H:%i:%s') fechaCreacion FROM cont_regularizacion_evidencias WHERE empresa_id=? AND entidad_id=? AND ejercicio_id=? ORDER BY solicitud_id,codigo,version DESC`,[empresaId,entidadId,ejercicioId]);
 const expedientes=ctx.solicitudes.map(s=>{
 const borrador=ctx.preparacion.revisiones.find(b=>b.version===s.borradorVersion);
 const huellaBase=huellaCondiciones({empresaId,entidadId,ejercicioId,solicitud:s,revisionDocumental:ctx.preparacion.historialOrigen,borrador:borrador??null,condiciones:ctx.preparacion.politica.huellaCondiciones,bloqueantes:ctx.bloqueantes});
 const evidencias:Evidencia[]=rows.filter(r=>r.solicitudId===s.id).map(r=>{let d;try{d=JSON.parse(r.metadatos_json);}catch{}return {codigo:String(r.codigo),version:Number(r.version),estado:String(d?.estado??'INVALIDA'),referencia:String(d?.referencia??''),huellaDocumento:d?.huellaDocumento??null,justificacion:String(d?.justificacion??''),creadoPor:Number(r.creado_por),creadoEn:String(r.fechaCreacion),huellaBase:String(r.huella_base),integra:evidenciaEntrada.safeParse(d).success&&huellaCondiciones(d)===r.huella_metadatos&&d.codigo===r.codigo&&d.solicitudId===s.id&&d.versionEsperada===Number(r.version)-1&&d.huellaExpediente===r.huella_base};});
 const motivos=[...s.motivos,...s.bloqueantes,...(!borrador?['BORRADOR_AUSENTE']:[]),...(['DEVUELTA','RECHAZADA','INVALIDADA'].includes(s.estado)?['SOLICITUD_FINALIZADA']:[]),...evaluarEvidencias(evidencias,huellaBase)];
 return {solicitud:s,borrador,revisionDocumental:ctx.preparacion.historialOrigen,evidencias,huellaBase,huellaExpediente:huellaCondiciones({huellaBase,evidencias}),motivos,completoTecnicamente:motivos.length===0,aprobadoFormalmente:false as const};
 });return {empresaId,entidadId,ejercicioId,expedientes,aviso:'Validacion tecnica documental; no acredita autenticidad ni aprobacion formal.',aprobacionFormalHabilitada:false as const};
}
export async function consultarExpedientes(empresaId:number,entidadId:number,ejercicioId:number,usuarioId:number){const c=await getPool().getConnection();try{await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');await c.query('START TRANSACTION READ ONLY');const d=await expedienteTx(c,empresaId,entidadId,ejercicioId),puedeGestionar=await permisoGestion(c,empresaId,usuarioId);await c.commit();return {...d,puedeGestionar,usuarioId};}catch(e){await c.rollback();throw e;}finally{c.release();}}
export type Expedientes=Awaited<ReturnType<typeof consultarExpedientes>>;
export async function registrarEvidencia(empresaId:number,entidadId:number,ejercicioId:number,actor:{id:number;username:string},input:unknown){const d=evidenciaEntrada.parse(input),c=await getPool().getConnection();try{
 await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');await c.beginTransaction();await bloquearGestion(c,empresaId,entidadId,ejercicioId,actor,[]);
 if(!await permisoGestion(c,empresaId,actor.id))throw new AccesoContable('Permiso explicito de gestion requerido.',403);
 const hash=huellaCondiciones({empresaId,entidadId,ejercicioId,actorId:actor.id,...d});
 const [prev]=await c.query<RowDataPacket[]>('SELECT huella_solicitud FROM cont_regularizacion_evidencias WHERE empresa_id=? AND entidad_id=? AND clave_idempotencia=?',[empresaId,entidadId,d.claveIdempotencia]);
 if(prev.length){if(prev[0].huella_solicitud!==hash)throw new AccesoContable('Clave utilizada con otro contenido o actor.',409);await c.commit();return {reutilizado:true};}
 const ctx=await expedienteTx(c,empresaId,entidadId,ejercicioId),e=ctx.expedientes.find(e=>e.solicitud.id===d.solicitudId),roles=e?.solicitud.politica?.responsables;
 if(!e||!roles)throw new AccesoContable('Solicitud no disponible en este ambito.',404);
 if(!Object.values(roles).includes(actor.id))throw new AccesoContable('Solo responsables designados.',403);
 if(e.solicitud.obsoleta||['DEVUELTA','RECHAZADA','INVALIDADA'].includes(e.solicitud.estado))throw new AccesoContable('Solicitud desactualizada o finalizada.',409);
 const anterior=e.evidencias.find(x=>x.codigo===d.codigo);
 if(e.huellaExpediente!==d.huellaExpediente||(anterior?.version??0)!==d.versionEsperada)throw new AccesoContable('Expediente o evidencia cambio; actualiza la consulta.',409);
 if(d.estado==='VERIFICADA_TECNICAMENTE'&&(actor.id!==roles.revisorId||!anterior||anterior.creadoPor===actor.id||anterior.estado!=='NO_VERIFICADA'||anterior.referencia!==d.referencia||anterior.huellaDocumento!==d.huellaDocumento))throw new AccesoContable('Revision independiente requiere la misma referencia y huella previamente declaradas por otro responsable.',403);
 const metadatos={...d,huellaExpediente:e.huellaBase};
 await c.execute('INSERT INTO cont_regularizacion_evidencias(empresa_id,entidad_id,ejercicio_id,solicitud_id,codigo,version,metadatos_json,huella_metadatos,huella_base,clave_idempotencia,huella_solicitud,creado_por) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',[empresaId,entidadId,ejercicioId,d.solicitudId,d.codigo,d.versionEsperada+1,JSON.stringify(metadatos),huellaCondiciones(metadatos),e.huellaBase,d.claveIdempotencia,hash,actor.id]);
 await registrarAuditoriaTx(c,{empresaId,usuario:actor.username,modulo:'contabilidad',accion:'expediente_evidencia_versionar',detalle:JSON.stringify({entidadId,ejercicioId,solicitudId:d.solicitudId,codigo:d.codigo,version:d.versionEsperada+1,huellaMetadatos:huellaCondiciones(metadatos),aprobacionFormal:false})});await c.commit();return {reutilizado:false};
 }catch(e){await c.rollback();throw e;}finally{c.release();}}
