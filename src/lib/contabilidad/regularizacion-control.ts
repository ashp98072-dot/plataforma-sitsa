import type {PoolConnection,RowDataPacket} from 'mysql2/promise';
import {z} from 'zod';
import {getPool} from '@/lib/db';
import {registrarAuditoriaTx} from '@/lib/auditoria';
import {AccesoContable,bloquearAmbito} from './ambito';
import {consultarRegularizacionTx} from './regularizacion';
import {construirPropuestaRegularizacion} from './propuesta-regularizacion-calculo';
import {DECISIONES_PENDIENTES,huellaCondiciones,identificarOrigen,type AsientoOrigen,type MetadatoOrigen} from './regularizacion-control-contrato';

const id=z.number().int().positive().max(2147483647);
export const borradorEntrada=z.strictObject({huellaCondiciones:z.string().regex(/^[0-9a-f]{64}$/),versionEsperada:z.number().int().min(0).max(2147483646),claveIdempotencia:z.uuid().transform(s=>s.toLowerCase()),nota:z.string().trim().min(5).max(500)});
export const origenEntrada=z.strictObject({asientoId:id,huellaAsiento:z.string().regex(/^[0-9a-f]{64}$/),clase:z.enum(['REGULARIZACION','NORMAL']),referencia:z.string().trim().min(5).max(120),confirmacion:z.literal('DOCUMENTACION_DE_ORIGEN_REVISADA')});
type Actor={id:number;username:string};
type Revision={id:string;version:number;estado:string;huellaCondiciones:string;nota:string;creadoPor:number;creadoEn:string};
function ids(...values:number[]){for(const v of values)id.parse(v);}
async function permisoEscritura(c:PoolConnection,empresaId:number,usuarioId:number){
 // También Admin necesita asignación y permiso explícitos. No se crea un permiso nuevo.
 const [rows]=await c.query<RowDataPacket[]>(`SELECT u.id FROM usuarios u WHERE u.id=? AND u.activo=1
  AND EXISTS(SELECT 1 FROM usuario_empresa e WHERE e.usuario_id=u.id AND e.empresa_id=?)
  AND EXISTS(SELECT 1 FROM usuario_modulo p WHERE p.usuario_id=u.id AND p.empresa_id IS NULL AND p.modulo='contabilidad' AND p.puede_ver=1 AND p.puede_editar=1)`,[usuarioId,empresaId]);
 return rows.length===1;
}
async function revisionesTx(c:PoolConnection,empresaId:number,entidadId:number,ejercicioId:number):Promise<Revision[]>{
 const [rows]=await c.query<RowDataPacket[]>(`SELECT CAST(id AS CHAR) id,version,estado,huella_condiciones huellaCondiciones,nota,creado_por creadoPor,DATE_FORMAT(creado_en,'%Y-%m-%dT%H:%i:%s') creadoEn
 FROM cont_regularizacion_borradores WHERE empresa_id=? AND entidad_id=? AND ejercicio_id=? ORDER BY version DESC LIMIT 20`,[empresaId,entidadId,ejercicioId]);
 return rows as Revision[];
}
/** Contrato de huella compartido por el lector y los futuros emisores controlados de procedencia. */
export async function asientosOrigenTx(c:PoolConnection,empresaId:number,entidadId:number,inicio:string,fin:string):Promise<AsientoOrigen[]>{
 const [rows]=await c.query<RowDataPacket[]>(`SELECT a.id,DATE_FORMAT(a.fecha,'%Y-%m-%d') fecha,a.numero,a.estado,a.glosa,a.creado_por creadoPor,
 d.id lineaId,d.cuenta_id cuentaId,CAST(d.debe AS CHAR) debe,CAST(d.haber AS CHAR) haber
 FROM cont_asientos a LEFT JOIN cont_asiento_detalle d ON d.asiento_id=a.id AND d.empresa_id=a.empresa_id AND d.entidad_id=a.entidad_id
 WHERE a.empresa_id=? AND a.entidad_id=? AND a.fecha>=? AND a.fecha<=? ORDER BY a.id,d.id`,[empresaId,entidadId,inicio,fin]);
 const map=new Map<number,AsientoOrigen>();
 for(const r of rows){const key=Number(r.id);let a=map.get(key);if(!a){a={id:key,fecha:String(r.fecha),numero:String(r.numero),estado:String(r.estado),glosa:r.glosa===null?null:String(r.glosa),creadoPor:r.creadoPor===null?null:String(r.creadoPor),lineas:[]};map.set(key,a);}if(r.lineaId!==null)a.lineas.push({id:Number(r.lineaId),cuentaId:Number(r.cuentaId),debe:String(r.debe),haber:String(r.haber)});}
 return [...map.values()];
}
async function prepararTx(c:PoolConnection,empresaId:number,entidadId:number,ejercicioId:number){
 const base=await consultarRegularizacionTx(c,empresaId,entidadId,ejercicioId);
 const anterior=construirPropuestaRegularizacion(base);
 const {fechaInicio,fechaFin}=base.ejercicio;
 const asientos=await asientosOrigenTx(c,empresaId,entidadId,String(fechaInicio),String(fechaFin));
 const [origenRows]=await c.query<RowDataPacket[]>(`SELECT o.asiento_id asientoId,o.ejercicio_id ejercicioId,o.clase,o.fuente,o.referencia,o.huella_asiento huella,o.registrado_por registradoPor
 FROM cont_asientos_origen o JOIN cont_asientos a ON a.id=o.asiento_id AND a.empresa_id=o.empresa_id AND a.entidad_id=o.entidad_id
 WHERE o.empresa_id=? AND o.entidad_id=? AND a.fecha>=? AND a.fecha<=? ORDER BY o.asiento_id`,[empresaId,entidadId,fechaInicio,fechaFin]);
 const origenes=asientos.map(a=>identificarOrigen(a,origenRows as MetadatoOrigen[],ejercicioId,base.cuentaResultado?.id??null));
 const registradas=origenes.filter(a=>a.estado==='Registrado');
 const identificadas=registradas.filter(a=>a.origen==='REGULARIZACION_IDENTIFICADA').length;
 const indicios=registradas.filter(a=>a.origen==='INDICIO').length;
 const adicionales=[...(identificadas?['REGULARIZACION_PREVIA_IDENTIFICADA']:[]),...(identificadas>1?['REGULARIZACIONES_MULTIPLES_IDENTIFICADAS']:[]),...(indicios?['INDICIOS_REGULARIZACION_PREVIA']:[]),...(origenes.some(o=>o.metadatoInvalido)?['METADATOS_ORIGEN_INVALIDOS']:[])];
 const [catalogo]=await c.query<RowDataPacket[]>('SELECT id,codigo,nombre,tipo,nivel,activa FROM cont_cuentas WHERE empresa_id=? AND entidad_id=? ORDER BY id',[empresaId,entidadId]);
 const [rol]=await c.query<RowDataPacket[]>("SELECT cuenta_id,activa,DATE_FORMAT(actualizado_en,'%Y-%m-%dT%H:%i:%s') actualizadoEn FROM cont_cuentas_rol WHERE empresa_id=? AND entidad_id=? AND rol='RESULTADO_EJERCICIO' ORDER BY cuenta_id",[empresaId,entidadId]);
 const [versionesPeriodos]=await c.query<RowDataPacket[]>('SELECT id,version,revision_cierre FROM cont_periodos WHERE empresa_id=? AND entidad_id=? AND ejercicio_id=? ORDER BY id',[empresaId,entidadId,ejercicioId]);
 const condiciones={contrato:'C3C9-PREP-1',empresaId,entidadId,ejercicioId,politicaBase:anterior.politica,
  resumenMonetario:{ingresos:base.calculo.ingresos,gastos:base.calculo.gastos,resultado:base.calculo.resultadoPreliminar},
  validaciones:[...anterior.bloqueantesTecnicos,...adicionales],calendario:{ejercicio:base.ejercicio,periodos:base.diagnostico.periodos,versionesPeriodos,control:base.diagnostico.control},catalogo,rol,asientos,metadatos:origenRows};
 const huella=huellaCondiciones(condiciones);
 const politica={contrato:'C3C9-PREP-1',version:1,base:anterior.politica.version,empresaId,entidadId,ejercicioId,estado:'BORRADOR_NO_APROBADO',
  cuentasNominales:base.calculo.nominales.map(a=>({id:a.cuentaId,codigo:a.codigo,tipo:a.tipo,activa:a.activa,saldoEjercicio:a.saldoEjercicio})),
  cuentaResultado:base.cuentaResultado,tratamiento:anterior.politica.tratamientoSignos,incluirHistoriaAnterior:false,
  idoneidad:{tecnica:base.configuracionResultado,formal:'PENDIENTE',requisitos:['ACTIVA','CAPITAL','MISMO_LIBRO','IMPUTABILIDAD_FORMAL_PENDIENTE']},
  decisionesPendientes:DECISIONES_PENDIENTES,huellaCondiciones:huella,aprobada:false};
 const revisiones=await revisionesTx(c,empresaId,entidadId,ejercicioId);
 const vigente=!revisiones[0]||revisiones[0].huellaCondiciones===huella;
 const bloqueantes=[...new Set([...anterior.bloqueantesTecnicos,...adicionales,...(!vigente?['BORRADOR_DESACTUALIZADO']:[])])];
 return {empresaId,entidadId,ejercicioId,ejercicio:base.ejercicio,estadoPreparacion:!vigente?'DESACTUALIZADA':bloqueantes.length?'CON_BLOQUEANTES':'PREPARACION_TECNICA',politica,
  bloqueantes,pendientesFormales:DECISIONES_PENDIENTES,origenes,revisiones,borradorVigente:vigente,
  resumen:base.calculo,propuestaSimulada:bloqueantes.length?null:anterior.propuestaSimulada,
  aprobado:false,contabilizado:false,listaParaContabilizar:false,generadoEn:base.generadoEn,
  aviso:'PREPARACIÓN TÉCNICA — NO APROBADA NI CONTABILIZADA. Guardar un borrador no autoriza regularizar. La procedencia histórica sin evidencia explícita permanece NO VERIFICADA.'};
}
export async function consultarPreparacion(empresaId:number,entidadId:number,ejercicioId:number,usuarioId:number){
 ids(empresaId,entidadId,ejercicioId,usuarioId);const c=await getPool().getConnection();
 try{await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');await c.query('START TRANSACTION READ ONLY');const d=await prepararTx(c,empresaId,entidadId,ejercicioId);const puedeGuardar=await permisoEscritura(c,empresaId,usuarioId);await c.commit();return {...d,puedeGuardar};}
 catch(e){try{await c.rollback();}catch{}throw e;}finally{c.release();}
}
/** Bloqueos antes de la primera lectura consistente: catálogo, períodos, configuración y movimientos no pueden cambiar durante el guardado. */
async function bloquearFuentes(c:PoolConnection,empresaId:number,entidadId:number,ejercicioId:number,actor:Actor){
 await bloquearAmbito(c,empresaId,{entidadId,usuarioId:actor.id,admin:false},true);
 const [e]=await c.query<RowDataPacket[]>('SELECT id,fecha_inicio,fecha_fin FROM cont_ejercicios WHERE empresa_id=? AND entidad_id=? AND id=? FOR UPDATE',[empresaId,entidadId,ejercicioId]);
 if(e.length!==1)throw new AccesoContable('Ejercicio no disponible en este libro.',404);
 for(const table of ['cont_periodos','cont_cuentas','cont_cuentas_rol','cont_asientos','cont_asiento_detalle','cont_asientos_origen','cont_regularizacion_borradores']){
  // Nombres constantes, no aportados por la petición. Se serializa el libro completo.
  await c.query(`SELECT ${table==='cont_cuentas_rol'?'cuenta_id':table==='cont_asientos_origen'?'asiento_id':'id'} FROM ${table} WHERE empresa_id=? AND entidad_id=? FOR UPDATE`,[empresaId,entidadId]);
 }
 // La revocación de usuario, asignación o permiso tampoco puede intercalarse con la escritura.
 await c.query('SELECT id FROM usuarios WHERE id=? FOR UPDATE',[actor.id]);
 await c.query('SELECT usuario_id FROM usuario_empresa WHERE usuario_id=? AND empresa_id=? FOR UPDATE',[actor.id,empresaId]);
 await c.query("SELECT usuario_id FROM usuario_modulo WHERE usuario_id=? AND empresa_id IS NULL AND modulo='contabilidad' FOR UPDATE",[actor.id]);
}
export async function guardarPreparacion(empresaId:number,entidadId:number,ejercicioId:number,actor:Actor,input:unknown){
 ids(empresaId,entidadId,ejercicioId,actor.id);const d=borradorEntrada.parse(input),c=await getPool().getConnection();
 try{await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');await c.beginTransaction();await bloquearFuentes(c,empresaId,entidadId,ejercicioId,actor);
  if(!await permisoEscritura(c,empresaId,actor.id))throw new AccesoContable('Se requiere asignación de empresa y permiso explícito Contabilidad: ver y editar para guardar borradores.',403);
  const solicitud=huellaCondiciones({empresaId,entidadId,ejercicioId,usuarioId:actor.id,...d});
  const [prev]=await c.query<RowDataPacket[]>('SELECT CAST(id AS CHAR) id,version,huella_solicitud FROM cont_regularizacion_borradores WHERE empresa_id=? AND entidad_id=? AND clave_idempotencia=?',[empresaId,entidadId,d.claveIdempotencia]);
  if(prev[0]){if(prev[0].huella_solicitud!==solicitud)throw new AccesoContable('Clave de idempotencia usada con otra solicitud.',409);await c.commit();return {id:String(prev[0].id),version:Number(prev[0].version),estado:'BORRADOR',reutilizado:true};}
  const actual=await prepararTx(c,empresaId,entidadId,ejercicioId);
  if(actual.politica.huellaCondiciones!==d.huellaCondiciones)throw new AccesoContable('Las condiciones cambiaron; vuelve a consultar antes de preparar.',409);
  const version=Number(actual.revisiones[0]?.version??0);
  if(version!==d.versionEsperada)throw new AccesoContable('Existe una revisión más reciente; vuelve a consultar.',409);
  await c.execute(`INSERT INTO cont_regularizacion_borradores(empresa_id,entidad_id,ejercicio_id,version,clave_idempotencia,huella_solicitud,huella_condiciones,politica_json,nota,creado_por)
   VALUES (?,?,?,?,?,?,?,?,?,?)`,[empresaId,entidadId,ejercicioId,version+1,d.claveIdempotencia,solicitud,d.huellaCondiciones,JSON.stringify({politica:actual.politica,bloqueantes:actual.bloqueantes,pendientesFormales:actual.pendientesFormales,origenes:actual.origenes}),d.nota,actor.id]);
  const [created]=await c.query<RowDataPacket[]>('SELECT CAST(id AS CHAR) id FROM cont_regularizacion_borradores WHERE empresa_id=? AND entidad_id=? AND clave_idempotencia=?',[empresaId,entidadId,d.claveIdempotencia]);
  await registrarAuditoriaTx(c,{empresaId,usuario:actor.username,modulo:'contabilidad',accion:'regularizacion_borrador_preparar',detalle:JSON.stringify({usuarioId:actor.id,empresaId,entidadId,ejercicioId,versionAnterior:version,versionNueva:version+1,huellaCondiciones:d.huellaCondiciones,aprobado:false,contabilizado:false})});
  await c.commit();return {id:String(created[0].id),version:version+1,estado:'BORRADOR',reutilizado:false};
 }catch(e){try{await c.rollback();}catch{}throw e;}finally{c.release();}
}
export type PreparacionRegularizacion=Awaited<ReturnType<typeof consultarPreparacion>>;
/** Declaración documental inmutable y separada del asiento; no constituye aprobación contable. */
export async function registrarOrigenDocumentado(empresaId:number,entidadId:number,ejercicioId:number,actor:Actor,input:unknown){
 ids(empresaId,entidadId,ejercicioId,actor.id);const d=origenEntrada.parse(input),c=await getPool().getConnection();
 try{await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');await c.beginTransaction();await bloquearFuentes(c,empresaId,entidadId,ejercicioId,actor);
  if(!await permisoEscritura(c,empresaId,actor.id))throw new AccesoContable('Sin autorización explícita para registrar evidencia documental.',403);
  const [e]=await c.query<RowDataPacket[]>("SELECT DATE_FORMAT(fecha_inicio,'%Y-%m-%d') inicio,DATE_FORMAT(fecha_fin,'%Y-%m-%d') fin FROM cont_ejercicios WHERE empresa_id=? AND entidad_id=? AND id=?",[empresaId,entidadId,ejercicioId]);
  const asientos=await asientosOrigenTx(c,empresaId,entidadId,e[0].inicio,e[0].fin),a=asientos.find(a=>a.id===d.asientoId);
  if(!a)throw new AccesoContable('Asiento no disponible en este ejercicio y libro.',404);
  if(a.estado!=='Registrado')throw new AccesoContable('Solo se identifica documentalmente un asiento Registrado.',422);
  if(huellaCondiciones(a)!==d.huellaAsiento)throw new AccesoContable('El asiento cambió; vuelve a consultar su huella.',409);
  const [existing]=await c.query<RowDataPacket[]>('SELECT * FROM cont_asientos_origen WHERE empresa_id=? AND entidad_id=? AND asiento_id=?',[empresaId,entidadId,d.asientoId]);
  if(existing[0]){const x=existing[0];if(x.fuente!=='REVISION_DOCUMENTADA'||x.clase!==d.clase||x.referencia!==d.referencia||x.huella_asiento!==d.huellaAsiento||Number(x.registrado_por)!==actor.id||Number(x.ejercicio_id)!==ejercicioId)throw new AccesoContable('Existe una identificación distinta; no se sobrescribe evidencia de origen.',409);await c.commit();return {registrado:true,reutilizado:true};}
  const [reference]=await c.query<RowDataPacket[]>("SELECT asiento_id FROM cont_asientos_origen WHERE empresa_id=? AND entidad_id=? AND fuente='REVISION_DOCUMENTADA' AND referencia=?",[empresaId,entidadId,d.referencia]);
  if(reference.length)throw new AccesoContable('La referencia documental ya identifica otro asiento.',409);
  await c.execute("INSERT INTO cont_asientos_origen(empresa_id,entidad_id,asiento_id,ejercicio_id,clase,fuente,referencia,huella_asiento,registrado_por) VALUES (?,?,?,?,?,'REVISION_DOCUMENTADA',?,?,?)",[empresaId,entidadId,d.asientoId,ejercicioId,d.clase,d.referencia,d.huellaAsiento,actor.id]);
  await registrarAuditoriaTx(c,{empresaId,usuario:actor.username,modulo:'contabilidad',accion:'regularizacion_origen_documentar',detalle:JSON.stringify({usuarioId:actor.id,empresaId,entidadId,ejercicioId,asientoId:d.asientoId,anterior:null,clase:d.clase,fuente:'REVISION_DOCUMENTADA',referencia:d.referencia,huellaAsiento:d.huellaAsiento,aprobacionContable:false})});
  await c.commit();return {registrado:true,reutilizado:false};
 }catch(e){try{await c.rollback();}catch{}throw e;}finally{c.release();}
}
