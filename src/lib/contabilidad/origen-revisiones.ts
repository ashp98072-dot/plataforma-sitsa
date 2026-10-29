import type {RowDataPacket} from 'mysql2/promise';
import {z} from 'zod';
import {getPool} from '@/lib/db';
import {registrarAuditoriaTx} from '@/lib/auditoria';
import {AccesoContable} from './ambito';
import {asientosOrigenTx,bloquearFuentes,permisoEscritura} from './regularizacion-control';
import {huellaCondiciones,type MetadatoOrigen} from './regularizacion-control-contrato';
import {resolverRevisiones,revisionesOrigenTx} from './origen-revisiones-contrato';

const id=z.number().int().positive().max(2147483647),hash=z.string().regex(/^[0-9a-f]{64}$/);
export const revisionOrigenEntrada=z.strictObject({asientoId:id,versionEsperada:z.number().int().min(0).max(2147483646),huellaVigente:hash,huellaAsiento:hash,
 tipo:z.enum(['REVISION_DOCUMENTAL','RECTIFICACION_DOCUMENTAL']),clase:z.enum(['NORMAL','REGULARIZACION']),justificacion:z.string().trim().min(10).max(1000),referencia:z.string().trim().min(5).max(120),
 claveIdempotencia:z.uuid().transform(s=>s.toLowerCase()),confirmacion:z.literal('DOCUMENTACION_REVISADA_SIN_APROBACION_CONTABLE')});

/** Añade una transición inmutable. La raíz, asientos, períodos y borradores previos no se actualizan. */
export async function revisarOrigen(empresaId:number,entidadId:number,ejercicioId:number,actor:{id:number;username:string},input:unknown){
 for(const v of [empresaId,entidadId,ejercicioId,actor.id])id.parse(v);
 const d=revisionOrigenEntrada.parse(input),c=await getPool().getConnection();
 try{
  await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');await c.beginTransaction();
  await bloquearFuentes(c,empresaId,entidadId,ejercicioId,actor);
  if(!await permisoEscritura(c,empresaId,actor.id))throw new AccesoContable('Se requiere asignación y permiso explícito Contabilidad: ver y editar.',403);
  const solicitud=huellaCondiciones({empresaId,entidadId,ejercicioId,actorId:actor.id,...d});
  const [reintentos]=await c.query<RowDataPacket[]>('SELECT asiento_id,version,huella_solicitud FROM cont_asientos_origen_revisiones WHERE empresa_id=? AND entidad_id=? AND clave_idempotencia=?',[empresaId,entidadId,d.claveIdempotencia]);
  if(reintentos[0]){if(reintentos[0].huella_solicitud!==solicitud)throw new AccesoContable('Clave utilizada con otra solicitud o actor.',409);await c.commit();return {asientoId:Number(reintentos[0].asiento_id),version:Number(reintentos[0].version),reutilizado:true,aprobacionContable:false};}
  const [ej]=await c.query<RowDataPacket[]>("SELECT DATE_FORMAT(fecha_inicio,'%Y-%m-%d') inicio,DATE_FORMAT(fecha_fin,'%Y-%m-%d') fin FROM cont_ejercicios WHERE empresa_id=? AND entidad_id=? AND id=?",[empresaId,entidadId,ejercicioId]);
  const asientos=await asientosOrigenTx(c,empresaId,entidadId,ej[0].inicio,ej[0].fin),a=asientos.find(a=>a.id===d.asientoId);
  if(!a)throw new AccesoContable('Asiento no disponible en este ejercicio y libro.',404);
  if(a.estado!=='Registrado')throw new AccesoContable('Solo se revisa la procedencia de asientos Registrados.',422);
  const [raiz]=await c.query<RowDataPacket[]>("SELECT asiento_id asientoId,ejercicio_id ejercicioId,clase,fuente,referencia,huella_asiento huella,registrado_por registradoPor,DATE_FORMAT(creado_en,'%Y-%m-%dT%H:%i:%s') creadoEn FROM cont_asientos_origen WHERE empresa_id=? AND entidad_id=? AND asiento_id=?",[empresaId,entidadId,d.asientoId]);
  if(!raiz[0]||Number(raiz[0].ejercicioId)!==ejercicioId)throw new AccesoContable('Falta identificación original válida en este ejercicio. No se puede rectificar otro ámbito.',409);
  const historial=await revisionesOrigenTx(c,empresaId,entidadId,ej[0].inicio,ej[0].fin),actual=resolverRevisiones(raiz[0] as MetadatoOrigen,historial.filter(r=>r.asientoId===d.asientoId));
  if(actual.invalida)throw new AccesoContable('Cadena documental inconsistente; requiere investigación independiente.',409);
  if(actual.version!==d.versionEsperada||actual.huellaVigente!==d.huellaVigente||huellaCondiciones(a)!==d.huellaAsiento)throw new AccesoContable('La procedencia o el asiento cambió; vuelve a consultar.',409);
  const cambia=d.clase!==actual.vigente.clase;
  if((d.tipo==='RECTIFICACION_DOCUMENTAL')!==cambia)throw new AccesoContable('La rectificación cambia clasificación; una revisión conserva clasificación.',422);
  if(cambia&&actor.id===actual.vigente.registradoPor)throw new AccesoContable('La rectificación exige otro editor autorizado distinto del autor de la declaración vigente. No es aprobación contable.',403);
  const [refs]=await c.query<RowDataPacket[]>(`SELECT asiento_id FROM cont_asientos_origen WHERE empresa_id=? AND entidad_id=? AND referencia=? AND asiento_id<>?
   UNION ALL SELECT asiento_id FROM cont_asientos_origen_revisiones WHERE empresa_id=? AND entidad_id=? AND referencia=? AND asiento_id<>?`,[empresaId,entidadId,d.referencia,d.asientoId,empresaId,entidadId,d.referencia,d.asientoId]);
  if(refs.length)throw new AccesoContable('La referencia ya pertenece a otro asiento del libro.',409);
  const version=actual.version+1;
  await c.execute(`INSERT INTO cont_asientos_origen_revisiones(empresa_id,entidad_id,asiento_id,ejercicio_id,version,tipo,clase_anterior,clase,referencia,justificacion,huella_anterior,huella_asiento,clave_idempotencia,huella_solicitud,registrado_por)
   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[empresaId,entidadId,d.asientoId,ejercicioId,version,d.tipo,actual.vigente.clase,d.clase,d.referencia,d.justificacion,d.huellaVigente,d.huellaAsiento,d.claveIdempotencia,solicitud,actor.id]);
  await registrarAuditoriaTx(c,{empresaId,usuario:actor.username,modulo:'contabilidad',accion:'origen_revision_documental',detalle:JSON.stringify({empresaId,entidadId,ejercicioId,asientoId:d.asientoId,usuarioId:actor.id,versionAnterior:actual.version,versionNueva:version,tipo:d.tipo,anterior:actual.vigente,claseNueva:d.clase,referencia:d.referencia,justificacion:d.justificacion,huellaAsiento:d.huellaAsiento,huellaAnterior:d.huellaVigente,aprobacionContable:false,contabilizado:false})});
  await c.commit();return {asientoId:d.asientoId,version,reutilizado:false,aprobacionContable:false};
 }catch(e){try{await c.rollback();}catch{}throw e;}finally{c.release();}
}
