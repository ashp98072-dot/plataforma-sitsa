import type {PoolConnection,RowDataPacket} from 'mysql2/promise';
import {getPool} from '@/lib/db';
import {registrarAuditoriaTx} from '@/lib/auditoria';
import {AccesoContable} from './ambito';
import {bloquearFuentes,permisoEscritura,prepararTx} from './regularizacion-control';
import {huellaCondiciones} from './regularizacion-control-contrato';
import {AVISO_AUTORIZACION,PENDIENTES_AUTORIZACION,gestionEntrada,idContable,estadoSolicitud,validarTransicion,type DecisionTecnica} from './politicas-autorizacion-contrato';

type Actor={id:number;username:string};
type Roles={preparadorId:number;revisorId:number;resolutorId:number};
type ContratoPolitica={contrato:string;codigo:string;version:number;empresaId:number;entidadId:number;ejercicioId:number;huellaCondiciones:string;
 cuentasNominales:{id:number;codigo:string;tipo:string}[];cuentaResultado:{id:number;codigo:string;nombre:string}|null;
 tratamientoSignos:string;reglasVigencia:string;justificacion:string;responsables:Roles;vigencia:{inicio:string;fin:string};estado:string;aprobada:false};
type Politica={codigo:string;version:number;huellaCondiciones:string;huellaPolitica:string;responsables:Roles;contrato:ContratoPolitica|null;integra:boolean;creadoPor:number;creadoEn:string};
type Evento={solicitudId:string;version:number;accion:DecisionTecnica;estadoAnterior:string;justificacion:string;huellaObservada:string;creadoPor:number;creadoEn:string};
type FuenteSolicitud={id:string;codigo:string;politicaVersion:number;borradorVersion:number;huellaCondiciones:string;justificacion:string;creadoPor:number;creadoEn:string};
const tablas=['cont_regularizacion_politicas','cont_regularizacion_solicitudes','cont_regularizacion_decisiones'] as const;
const fecha="'%Y-%m-%dT%H:%i:%s'";

export async function permisoGestion(c:PoolConnection,empresaId:number,usuarioId:number){
 if(!await permisoEscritura(c,empresaId,usuarioId))return false;
 const [rows]=await c.query<RowDataPacket[]>("SELECT COUNT(*) n FROM usuario_modulo WHERE usuario_id=? AND empresa_id IS NULL AND modulo='contabilidad'",[usuarioId]);
 // Una matriz ambigua no puede conferir autoridad para este flujo nuevo.
 return Number(rows[0].n)===1;
}

export async function bloquearGestion(c:PoolConnection,empresaId:number,entidadId:number,ejercicioId:number,actor:Actor,extras:number[]){
 await bloquearFuentes(c,empresaId,entidadId,ejercicioId,actor);
 const usuarios=new Set([actor.id,...extras]);
 for(const t of tablas){
  const [rows]=await c.query<RowDataPacket[]>(`SELECT * FROM ${t} WHERE empresa_id=? AND entidad_id=? FOR UPDATE`,[empresaId,entidadId]);
  if(t==='cont_regularizacion_politicas')for(const r of rows)for(const k of ['preparador_id','revisor_id','resolutor_id'])usuarios.add(Number(r[k]));
 }
 // Ninguna revocación de los tres responsables puede intercalarse con una acción aceptada.
 for(const usuario of [...usuarios].sort((a,b)=>a-b)){
  await c.query('SELECT id FROM usuarios WHERE id=? FOR UPDATE',[usuario]);
  await c.query('SELECT usuario_id FROM usuario_empresa WHERE usuario_id=? AND empresa_id=? FOR UPDATE',[usuario,empresaId]);
  await c.query("SELECT usuario_id FROM usuario_modulo WHERE usuario_id=? AND empresa_id IS NULL AND modulo='contabilidad' FOR UPDATE",[usuario]);
 }
}

export async function contextoTx(c:PoolConnection,empresaId:number,entidadId:number,ejercicioId:number){
 const preparacion=await prepararTx(c,empresaId,entidadId,ejercicioId);
 const [personas]=await c.query<RowDataPacket[]>(`SELECT DISTINCT u.id,u.username FROM usuarios u JOIN usuario_empresa e ON e.usuario_id=u.id AND e.empresa_id=?
 WHERE u.activo=1 AND (SELECT COUNT(*) FROM usuario_modulo m WHERE m.usuario_id=u.id AND m.empresa_id IS NULL AND m.modulo='contabilidad')=1
 AND EXISTS(SELECT 1 FROM usuario_modulo m WHERE m.usuario_id=u.id AND m.empresa_id IS NULL AND m.modulo='contabilidad' AND m.puede_ver=1 AND m.puede_editar=1) ORDER BY u.id`,[empresaId]);
 const elegibles=personas.map(r=>({id:Number(r.id),username:String(r.username)})),ids=new Set(elegibles.map(u=>u.id));
 const [pr]=await c.query<RowDataPacket[]>(`SELECT codigo,version,contrato_json,huella_politica,huella_condiciones,preparador_id,revisor_id,resolutor_id,creado_por,DATE_FORMAT(creado_en,${fecha}) creadoEn
 FROM cont_regularizacion_politicas WHERE empresa_id=? AND entidad_id=? AND ejercicio_id=? ORDER BY codigo,version DESC`,[empresaId,entidadId,ejercicioId]);
 const politicas:Politica[]=pr.map(r=>{
  let contrato:ContratoPolitica|null=null;try{contrato=JSON.parse(r.contrato_json);}catch{}
  const responsables={preparadorId:Number(r.preparador_id),revisorId:Number(r.revisor_id),resolutorId:Number(r.resolutor_id)};
  const integra=!!contrato&&contrato.contrato==='C3C11-POL-1'&&contrato.estado==='PROPUESTA_NO_APROBADA'&&contrato.aprobada===false&&contrato.empresaId===empresaId&&contrato.entidadId===entidadId&&contrato.ejercicioId===ejercicioId&&contrato.codigo===r.codigo&&contrato.version===Number(r.version)&&contrato.huellaCondiciones===r.huella_condiciones&&huellaCondiciones(contrato)===r.huella_politica&&!!contrato.responsables&&!!contrato.vigencia&&Array.isArray(contrato.cuentasNominales)&&huellaCondiciones(contrato.responsables)===huellaCondiciones(responsables)&&new Set(Object.values(responsables)).size===3&&Number(r.creado_por)===responsables.preparadorId;
  return {codigo:String(r.codigo),version:Number(r.version),contrato:integra?contrato:null,integra,responsables,huellaCondiciones:String(r.huella_condiciones),huellaPolitica:String(r.huella_politica),creadoPor:Number(r.creado_por),creadoEn:String(r.creadoEn)};
 });
 const [sr]=await c.query<RowDataPacket[]>(`SELECT CAST(id AS CHAR) id,politica_codigo codigo,politica_version politicaVersion,borrador_version borradorVersion,huella_condiciones huellaCondiciones,justificacion,creado_por creadoPor,DATE_FORMAT(creado_en,${fecha}) creadoEn
 FROM cont_regularizacion_solicitudes WHERE empresa_id=? AND entidad_id=? AND ejercicio_id=? ORDER BY id DESC`,[empresaId,entidadId,ejercicioId]);
 const [er]=await c.query<RowDataPacket[]>(`SELECT CAST(solicitud_id AS CHAR) solicitudId,version,accion,estado_anterior estadoAnterior,justificacion,huella_observada huellaObservada,creado_por creadoPor,DATE_FORMAT(creado_en,${fecha}) creadoEn
 FROM cont_regularizacion_decisiones WHERE empresa_id=? AND entidad_id=? AND ejercicio_id=? ORDER BY solicitud_id,version`,[empresaId,entidadId,ejercicioId]);
 const eventos=er as Evento[];
 const bloqueantes=[...preparacion.bloqueantes.filter(b=>b!=='BORRADOR_DESACTUALIZADO'),...(preparacion.origenes.some(o=>o.estado==='Registrado'&&!o.evidencia)?['PROCEDENCIA_NO_VERIFICADA']:[])];
 const solicitudes=(sr as FuenteSolicitud[]).map(s=>{
  const politica=politicas.find(p=>p.codigo===s.codigo&&p.version===s.politicaVersion),ultima=politicas.find(p=>p.codigo===s.codigo),historial=eventos.filter(e=>e.solicitudId===s.id);
  const responsables=politica?.responsables;let estado='PREPARADA',version=0,cadenaInvalida=false;
  for(const e of historial){
   if(!responsables||e.version!==version+1||e.estadoAnterior!==estado||validarTransicion(estado,e.accion,e.creadoPor,responsables,e.accion==='INVALIDAR',[])){
    cadenaInvalida=true;break;
   }
   estado=estadoSolicitud(e.accion);version=e.version;
  }
  const motivos=[...(!politica?.integra||cadenaInvalida?['INTEGRIDAD_POLITICA_O_HISTORIAL']:[]),...(ultima?.version!==s.politicaVersion?['POLITICA_SUPERADA']:[]),
   ...(s.huellaCondiciones!==preparacion.politica.huellaCondiciones||politica?.huellaCondiciones!==preparacion.politica.huellaCondiciones?['CONDICIONES_MODIFICADAS']:[]),
   ...(preparacion.revisiones[0]?.version!==s.borradorVersion?['BORRADOR_SUPERADO']:[]),
   ...(!responsables||Object.values(responsables).some(id=>!ids.has(id))?['RESPONSABLE_SIN_AUTORIZACION_VIGENTE']:[])];
  const parcial=preparacion.politica.cuentasNominales.some(a=>!politica?.contrato?.cuentasNominales.some(n=>n.id===a.id));
  return {...s,estado,estadoActual:cadenaInvalida?'INTEGRIDAD_INVALIDA':motivos.length&&!['DEVUELTA','RECHAZADA','INVALIDADA'].includes(estado)?'DESACTUALIZADA':estado,version,motivos,obsoleta:motivos.length>0,politica,historial,
   bloqueantes:[...bloqueantes,...(parcial?['ALCANCE_NOMINAL_PARCIAL']:[])],aprobacionContable:false,contabilizado:false};
 });
 return {preparacion,elegibles,politicas,solicitudes,bloqueantes};
}

export async function consultarPoliticasAutorizacion(empresaId:number,entidadId:number,ejercicioId:number,usuarioId:number){
 for(const x of [empresaId,entidadId,ejercicioId,usuarioId])idContable.parse(x);
 const c=await getPool().getConnection();try{
  await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');await c.query('START TRANSACTION READ ONLY');
  const d=await contextoTx(c,empresaId,entidadId,ejercicioId),puedeGestionar=await permisoGestion(c,empresaId,usuarioId);
  await c.commit();return {...d,elegibles:puedeGestionar?d.elegibles:[],puedeGestionar,usuarioId,aviso:AVISO_AUTORIZACION,pendientesFormales:PENDIENTES_AUTORIZACION,aprobacionFormalHabilitada:false};
 }catch(e){try{await c.rollback();}catch{}throw e;}finally{c.release();}
}
export type GestionPoliticas=Awaited<ReturnType<typeof consultarPoliticasAutorizacion>>;

export async function gestionarPoliticasAutorizacion(empresaId:number,entidadId:number,ejercicioId:number,actor:Actor,input:unknown){
 for(const x of [empresaId,entidadId,ejercicioId,actor.id])idContable.parse(x);
 const d=gestionEntrada.parse(input),c=await getPool().getConnection();
 try{
  await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');await c.beginTransaction();
  await bloquearGestion(c,empresaId,entidadId,ejercicioId,actor,d.operacion==='POLITICA'?[d.revisorId,d.resolutorId]:[]);
  if(!await permisoGestion(c,empresaId,actor.id))throw new AccesoContable('Se requiere asignación y permiso explícito Contabilidad: ver y editar, sin filas de permisos duplicadas o ambiguas.',403);
  const tabla=d.operacion==='POLITICA'?tablas[0]:d.operacion==='SOLICITUD'?tablas[1]:tablas[2];
  const huellaSolicitud=huellaCondiciones({empresaId,entidadId,ejercicioId,actorId:actor.id,...d});
  const [prev]=await c.query<RowDataPacket[]>(`SELECT * FROM ${tabla} WHERE empresa_id=? AND entidad_id=? AND clave_idempotencia=?`,[empresaId,entidadId,d.claveIdempotencia]);
  if(prev[0]){if(prev[0].huella_solicitud!==huellaSolicitud)throw new AccesoContable('Clave de idempotencia usada con otra solicitud o actor.',409);await c.commit();return {operacion:d.operacion,id:prev[0].id?String(prev[0].id):undefined,version:prev[0].version?Number(prev[0].version):undefined,reutilizado:true,aprobacionContable:false};}
  const ctx=await contextoTx(c,empresaId,entidadId,ejercicioId),prep=ctx.preparacion,huella=prep.politica.huellaCondiciones;
  const tieneResponsables=(r:Roles)=>new Set(Object.values(r)).size===3&&Object.values(r).every(id=>ctx.elegibles.some(u=>u.id===id));
  let resultado:{id?:string;version?:number},detalle:Record<string,unknown>;
  if(d.operacion==='POLITICA'){
   const anterior=ctx.politicas.find(p=>p.codigo===d.codigo);
   if((anterior?.version??0)!==d.versionEsperada||d.huellaCondiciones!==huella)throw new AccesoContable('Versión o condiciones cambiaron; vuelve a consultar.',409);
   if(anterior&&anterior.responsables.preparadorId!==actor.id)throw new AccesoContable('Solo el preparador responsable puede versionar esta política técnica.',403);
   const responsables={preparadorId:actor.id,revisorId:d.revisorId,resolutorId:d.resolutorId};
   if(!tieneResponsables(responsables))throw new AccesoContable('Se requieren tres responsables distintos, activos, asignados y con ver/editar explícitos.',403);
   if(!prep.politica.cuentaResultado||prep.politica.idoneidad.tecnica!=='VALIDADA_TECNICAMENTE'||prep.politica.cuentaResultado.id!==d.cuentaResultadoId)throw new AccesoContable('Cuenta de resultado no configurada o técnicamente inválida.',422);
   const nominales=prep.politica.cuentasNominales.filter(a=>d.cuentasNominales.includes(a.id));
   if(nominales.length!==d.cuentasNominales.length||nominales.some(a=>!a.activa||!['Ingreso','Gasto'].includes(a.tipo)))throw new AccesoContable('Cuentas nominales inexistentes, inactivas o de otro ámbito.',422);
   const version=d.versionEsperada+1;
   const contrato:ContratoPolitica={contrato:'C3C11-POL-1',codigo:d.codigo,version,empresaId,entidadId,ejercicioId,huellaCondiciones:huella,
    cuentasNominales:nominales.map(({id,codigo,tipo})=>({id,codigo,tipo})),cuentaResultado:prep.politica.cuentaResultado,tratamientoSignos:d.tratamientoSignos,
    reglasVigencia:d.reglasVigencia,justificacion:d.justificacion,responsables,vigencia:{inicio:String(prep.ejercicio.fechaInicio),fin:String(prep.ejercicio.fechaFin)},estado:'PROPUESTA_NO_APROBADA',aprobada:false};
   await c.execute(`INSERT INTO cont_regularizacion_politicas(empresa_id,entidad_id,ejercicio_id,codigo,version,contrato_json,huella_politica,huella_condiciones,preparador_id,revisor_id,resolutor_id,clave_idempotencia,huella_solicitud,creado_por) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [empresaId,entidadId,ejercicioId,d.codigo,version,JSON.stringify(contrato),huellaCondiciones(contrato),huella,actor.id,d.revisorId,d.resolutorId,d.claveIdempotencia,huellaSolicitud,actor.id]);
   resultado={version};detalle={codigo:d.codigo,versionAnterior:d.versionEsperada,versionNueva:version,contrato};
  }else if(d.operacion==='SOLICITUD'){
   const politica=ctx.politicas.find(p=>p.codigo===d.codigo),borrador=prep.revisiones[0];
   if(!politica?.integra||politica.version!==d.politicaVersion||politica.huellaCondiciones!==huella||d.huellaCondiciones!==huella||!borrador||borrador.version!==d.borradorVersion||borrador.huellaCondiciones!==huella)throw new AccesoContable('Política, borrador o condiciones no vigentes.',409);
   if(politica.responsables.preparadorId!==actor.id||borrador.creadoPor!==actor.id||!tieneResponsables(politica.responsables))throw new AccesoContable('Preparador o responsables sin autorización vigente.',403);
   if(ctx.solicitudes.some(s=>s.borradorVersion===d.borradorVersion))throw new AccesoContable('Ya existe solicitud para esta política y borrador; conserva su historial.',409);
   await c.execute(`INSERT INTO cont_regularizacion_solicitudes(empresa_id,entidad_id,ejercicio_id,politica_codigo,politica_version,borrador_version,huella_condiciones,justificacion,diagnostico_json,clave_idempotencia,huella_solicitud,creado_por) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [empresaId,entidadId,ejercicioId,d.codigo,d.politicaVersion,d.borradorVersion,huella,d.justificacion,JSON.stringify({bloqueantes:ctx.bloqueantes,origenes:prep.origenes,pendientesFormales:PENDIENTES_AUTORIZACION}),d.claveIdempotencia,huellaSolicitud,actor.id]);
   const [nueva]=await c.query<RowDataPacket[]>('SELECT CAST(id AS CHAR) id FROM cont_regularizacion_solicitudes WHERE empresa_id=? AND entidad_id=? AND clave_idempotencia=?',[empresaId,entidadId,d.claveIdempotencia]);
   resultado={id:String(nueva[0].id)};detalle={solicitudId:resultado.id,codigo:d.codigo,politicaVersion:d.politicaVersion,borradorVersion:d.borradorVersion,huellaCondiciones:huella,justificacion:d.justificacion,bloqueantes:ctx.bloqueantes};
  }else{
   const s=ctx.solicitudes.find(s=>s.id===d.solicitudId);
   if(!s?.politica)throw new AccesoContable('Solicitud no disponible en este ámbito.',404);
   if(s.version!==d.versionEsperada)throw new AccesoContable('Existe una decisión más reciente.',409);
   if(s.estadoActual==='INTEGRIDAD_INVALIDA')throw new AccesoContable('Historial inconsistente; requiere investigación independiente.',409);
   if(d.accion!=='INVALIDAR'&&!tieneResponsables(s.politica.responsables))throw new AccesoContable('Responsables sin autorización vigente.',403);
   const error=validarTransicion(s.estado,d.accion,actor.id,s.politica.responsables,s.obsoleta,s.bloqueantes);
   if(error)throw new AccesoContable(error.error,error.status);
   const version=s.version+1;
   await c.execute(`INSERT INTO cont_regularizacion_decisiones(empresa_id,entidad_id,ejercicio_id,solicitud_id,version,accion,estado_anterior,justificacion,huella_observada,clave_idempotencia,huella_solicitud,creado_por) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [empresaId,entidadId,ejercicioId,s.id,version,d.accion,s.estado,d.justificacion,huella,d.claveIdempotencia,huellaSolicitud,actor.id]);
   resultado={id:s.id,version};detalle={solicitudId:s.id,versionAnterior:s.version,versionNueva:version,estadoAnterior:s.estado,estadoNuevo:estadoSolicitud(d.accion),accion:d.accion,justificacion:d.justificacion,huellaObservada:huella,motivosObsolescencia:s.motivos};
  }
  await registrarAuditoriaTx(c,{empresaId,usuario:actor.username,modulo:'contabilidad',accion:'regularizacion_gestion_'+d.operacion.toLowerCase(),detalle:JSON.stringify({empresaId,entidadId,ejercicioId,usuarioId:actor.id,...detalle,aprobacionContable:false,contabilizado:false})});
  await c.commit();return {operacion:d.operacion,...resultado,reutilizado:false,aprobacionContable:false};
 }catch(e){try{await c.rollback();}catch{}throw e;}finally{c.release();}
}
