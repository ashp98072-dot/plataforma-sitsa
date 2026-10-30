import type {PoolConnection,RowDataPacket} from 'mysql2/promise';
import {getPool} from '@/lib/db';
import {registrarAuditoriaTx} from '@/lib/auditoria';
import {AccesoContable} from './ambito';
import {contextoTx,bloquearGestion,permisoGestion} from './politicas-autorizacion';
import {expedienteTx} from './expediente';
import {consultarRegularizacionTx} from './regularizacion';
import {asientosOrigenTx} from './regularizacion-control';
import {huellaCondiciones} from './regularizacion-control-contrato';
import {idContable} from './politicas-autorizacion-contrato';
import {AVISO_PRECONTABLE,constanciaEntrada,componentesCambiados,permisoConstancia,type Hallazgo} from './precontable-contrato';

type Contexto=Awaited<ReturnType<typeof contextoTx>>;
type Expediente=Awaited<ReturnType<typeof expedienteTx>>['expedientes'][number];
type Base=Awaited<ReturnType<typeof consultarRegularizacionTx>>;
type Actor={id:number;username:string};
const ambito=(empresaId:number,entidadId:number,ejercicioId:number)=>({empresaId,entidadId,ejercicioId});
function validarIds(...ids:number[]){ids.forEach(id=>idContable.parse(id));}

function construirInforme(ctx:Contexto,e:Expediente,base:Base,componentes:Record<string,string>){
 const referencia={tipo:'SOLICITUD_C3C11',id:e.solicitud.id};
 const hallazgos:Hallazgo[]=[...new Set([...ctx.preparacion.bloqueantes,...e.motivos])].map(codigo=>({codigo,nivel:'BLOQUEANTE',referencias:
  codigo.startsWith('EVIDENCIA')?[{tipo:'EVIDENCIA',id:codigo.split(':')[1]??'OBLIGATORIAS'}]:
  codigo.includes('POLITICA')?[{tipo:'POLITICA_C3C11',id:e.solicitud.codigo,version:e.solicitud.politicaVersion}]:
  codigo.includes('BORRADOR')?[{tipo:'BORRADOR_C3C9',id:String(e.solicitud.borradorVersion),version:e.solicitud.borradorVersion}]:
  codigo.includes('RESPONSABLE')?Object.values(e.solicitud.politica?.responsables??{}).map(id=>({tipo:'USUARIO',id:String(id)})):[referencia]}));
 for(const codigo of new Set([...base.advertencias,...ctx.preparacion.pendientesFormales,'AUTENTICIDAD_DOCUMENTAL_NO_CERTIFICADA']))hallazgos.push({codigo,nivel:'ADVERTENCIA',referencias:[referencia]});
 for(const o of ctx.preparacion.origenes)if(o.estado==='Registrado'&&!o.evidencia)hallazgos.push({codigo:'PROCEDENCIA_NO_VERIFICADA',nivel:'BLOQUEANTE',referencias:[{tipo:'ASIENTO',id:String(o.asientoId)}]});
 for(const p of base.diagnostico.periodos)if(p.estado!=='CERRADO')hallazgos.push({codigo:'PERIODO_NO_CERRADO',nivel:'BLOQUEANTE',referencias:[{tipo:'PERIODO',id:String(p.id)}]});
 for(const a of [...base.diagnostico.asientos.descuadrados.muestra,...base.diagnostico.asientos.integridad.muestra])hallazgos.push({codigo:'INTEGRIDAD_ASIENTO',nivel:'BLOQUEANTE',referencias:[{tipo:'ASIENTO',id:String(a.id)}]});
 for(const v of e.evidencias.filter((v,i,a)=>a.findIndex(x=>x.codigo===v.codigo)===i))if(!v.integra||v.estado!=='VERIFICADA_TECNICAMENTE'||v.huellaBase!==e.huellaBase)hallazgos.push({codigo:'EVIDENCIA_NO_VIGENTE',nivel:'BLOQUEANTE',referencias:[{tipo:'EVIDENCIA',id:v.codigo,version:v.version}]});
 return {
  contrato:'C3C13-INFORME-1' as const,...ambito(base.empresaId,base.entidadId,base.ejercicioId),
  solicitudId:e.solicitud.id,evaluadoEn:new Date().toISOString(),componentes,
  huellaIntegral:huellaCondiciones({contrato:'C3C13-CONDICIONES-1',...ambito(base.empresaId,base.entidadId,base.ejercicioId),componentes}),
  originales:{ejercicio:base.ejercicio,periodos:base.diagnostico.periodos,control:base.diagnostico.control,
   movimientos:base.diagnostico.asientos,saldos:base.calculo,cuentaResultado:base.cuentaResultado},
  simulacion:{fuente:'MOTOR_C3C8_C3C9',propuesta:ctx.preparacion.propuestaSimulada,politicaBase:ctx.preparacion.politica,contabilizada:false},
  expediente:e,hallazgos,completoTecnicamente:!hallazgos.some(h=>h.nivel==='BLOQUEANTE'),
  estadoFormal:'PENDIENTE' as const,aprobacionFormalHabilitada:false as const,contabilizado:false as const,aviso:AVISO_PRECONTABLE,
 };
}
export type InformePrecontable=ReturnType<typeof construirInforme>;
type Registro={contrato:'C3C13-CONSTANCIA-1';empresaId:number;entidadId:number;ejercicioId:number;solicitudId:string;version:number;anterior:string|null;actorId:number;justificacion:string;informe:InformePrecontable};

/** Una única instantánea. Las constancias no entran en la huella de sus propias fuentes. */
async function evaluarTx(c:PoolConnection,empresaId:number,entidadId:number,ejercicioId:number,usuarioId:number){
 const ctx=await contextoTx(c,empresaId,entidadId,ejercicioId);
 const expedientes=await expedienteTx(c,empresaId,entidadId,ejercicioId,ctx);
 const base=await consultarRegularizacionTx(c,empresaId,entidadId,ejercicioId);
 // Incluye historia anterior, aunque no cambie el neto del ejercicio. No crea otro motor.
 const movimientos=await asientosOrigenTx(c,empresaId,entidadId,'1000-01-01',String(base.ejercicio.fechaFin));
 // También huella detalles huérfanos o de ámbito inconsistente que el diagnóstico rechaza.
 const [detalles]=await c.query<RowDataPacket[]>(`SELECT d.id,d.empresa_id,d.entidad_id,d.asiento_id,d.cuenta_id,CAST(d.debe AS CHAR) debe,CAST(d.haber AS CHAR) haber FROM cont_asiento_detalle d WHERE (d.empresa_id=? AND d.entidad_id=?) OR EXISTS(SELECT 1 FROM cont_asientos a WHERE a.id=d.asiento_id AND a.empresa_id=? AND a.entidad_id=? AND a.fecha<=?) ORDER BY d.id`,[empresaId,entidadId,empresaId,entidadId,base.ejercicio.fechaFin]);
 const ids=[...new Set(ctx.politicas.flatMap(p=>Object.values(p.responsables)))].sort((a,b)=>a-b);
 const permisos:unknown[]=[];
 for(const id of ids){
  const [u]=await c.query<RowDataPacket[]>('SELECT id,activo FROM usuarios WHERE id=?',[id]);
  const [e]=await c.query<RowDataPacket[]>('SELECT usuario_id,empresa_id FROM usuario_empresa WHERE usuario_id=? AND empresa_id=?',[id,empresaId]);
  const [m]=await c.query<RowDataPacket[]>("SELECT usuario_id,empresa_id,modulo,puede_ver,puede_editar FROM usuario_modulo WHERE usuario_id=? AND empresa_id IS NULL AND modulo='contabilidad' ORDER BY puede_ver,puede_editar",[id]);
  permisos.push({id,usuario:u,asignaciones:e,modulos:m});
 }
 const componentes:Record<string,string>={};
 const fuentes={movimientos:{asientos:movimientos,detalles},permisos,calendario:{ejercicio:base.ejercicio,periodos:base.diagnostico.periodos,control:base.diagnostico.control},
  condicionesC3C9:ctx.preparacion.politica.huellaCondiciones,politicas:ctx.politicas,
  solicitudes:ctx.solicitudes.map(({historial,politica,...s})=>{void historial;void politica;return s;}),
  decisiones:ctx.solicitudes.map(s=>({id:s.id,historial:s.historial})),
  evidencias:expedientes.expedientes.map(e=>({id:e.solicitud.id,evidencias:e.evidencias})),procedencia:{origenes:ctx.preparacion.origenes,historial:ctx.preparacion.historialOrigen}};
 for(const [k,v] of Object.entries(fuentes))componentes[k]=huellaCondiciones(v);
 // Sin LIMIT: cambios incluso en borradores antiguos invalidan el informe histórico.
 const [borradores]=await c.query<RowDataPacket[]>('SELECT version,estado,huella_condiciones,politica_json,nota,creado_por FROM cont_regularizacion_borradores WHERE empresa_id=? AND entidad_id=? AND ejercicio_id=? ORDER BY version',[empresaId,entidadId,ejercicioId]);
 componentes.borradores=huellaCondiciones(borradores);
 const [catalogo]=await c.query<RowDataPacket[]>('SELECT id,codigo,nombre,tipo,nivel,activa FROM cont_cuentas WHERE empresa_id=? AND entidad_id=? ORDER BY id',[empresaId,entidadId]);
 const [configuracion]=await c.query<RowDataPacket[]>('SELECT rol,cuenta_id,activa FROM cont_cuentas_rol WHERE empresa_id=? AND entidad_id=? ORDER BY rol,cuenta_id',[empresaId,entidadId]);
 componentes.catalogoConfiguracion=huellaCondiciones({catalogo,configuracion});
 const [solicitudes]=await c.query<RowDataPacket[]>('SELECT CAST(id AS CHAR) id,politica_codigo,politica_version,borrador_version,huella_condiciones,justificacion,diagnostico_json,huella_solicitud,creado_por FROM cont_regularizacion_solicitudes WHERE empresa_id=? AND entidad_id=? AND ejercicio_id=? ORDER BY id',[empresaId,entidadId,ejercicioId]);
 componentes.solicitudes=huellaCondiciones(solicitudes);
 const [libro]=await c.query<RowDataPacket[]>('SELECT id,codigo,nombre,activa FROM cont_entidades WHERE empresa_id=? AND id=?',[empresaId,entidadId]);
 const [empresa]=await c.query<RowDataPacket[]>('SELECT id,nombre,activa,modulos_json FROM empresas WHERE id=?',[empresaId]);
 componentes.identificacion=huellaCondiciones({libro,empresa});
 const [rows]=await c.query<RowDataPacket[]>(`SELECT *,CAST(solicitud_id AS CHAR) solicitudId,DATE_FORMAT(creado_en,'%Y-%m-%dT%H:%i:%s') fecha FROM cont_regularizacion_evaluaciones WHERE empresa_id=? AND entidad_id=? AND ejercicio_id=? ORDER BY solicitud_id,version`,[empresaId,entidadId,ejercicioId]);
 const puedeGestionar=await permisoGestion(c,empresaId,usuarioId);
 const evaluaciones=expedientes.expedientes.map(e=>{
  const informe={...construirInforme(ctx,e,base,componentes),identificacion:{empresa:empresa[0],libro:libro[0]}};
  if(Number(empresa[0]?.activa)!==1||Number(libro[0]?.activa)!==1){informe.hallazgos.push({codigo:'AMBITO_INACTIVO',nivel:'BLOQUEANTE',referencias:[{tipo:'LIBRO',id:String(entidadId)}]});informe.completoTecnicamente=false;}
  let anterior:string|null=null,version=0,cadenaIntegra=true;
  const historial=rows.filter(r=>r.solicitudId===e.solicitud.id).map(r=>{
   let registro:Registro|null=null,integra=false;
   try{
    registro=JSON.parse(String(r.registro_json));
    const d=registro!;
    integra=d.contrato==='C3C13-CONSTANCIA-1'&&d.empresaId===empresaId&&d.entidadId===entidadId&&d.ejercicioId===ejercicioId&&d.solicitudId===e.solicitud.id&&d.version===version+1&&d.version===Number(r.version)&&d.anterior===anterior&&d.actorId===Number(r.creado_por)&&d.informe.huellaIntegral===r.huella_integral&&d.informe.solicitudId===d.solicitudId&&d.informe.empresaId===empresaId&&d.informe.entidadId===entidadId&&d.informe.ejercicioId===ejercicioId&&d.informe.aprobacionFormalHabilitada===false&&d.informe.contabilizado===false&&huellaCondiciones(d)===r.huella_registro;
    integra=integra&&d.actorId===d.informe.expediente.solicitud.politica?.responsables.revisorId&&typeof d.justificacion==='string'&&d.justificacion.trim().length>=15&&d.informe.contrato==='C3C13-INFORME-1'&&d.informe.estadoFormal==='PENDIENTE'&&!!d.informe.componentes&&Object.values(d.informe.componentes).every(v=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v));
    integra=integra&&d.informe.huellaIntegral===huellaCondiciones({contrato:'C3C13-CONDICIONES-1',...ambito(empresaId,entidadId,ejercicioId),componentes:d.informe.componentes});
   }catch{integra=false;}
   cadenaIntegra=cadenaIntegra&&integra;version=Number(r.version);anterior=String(r.huella_registro);
   const cambios=integra&&registro?componentesCambiados(registro.informe.componentes,componentes):['INTEGRIDAD_INVALIDA'];
   return {version,creadoPor:Number(r.creado_por),creadoEn:String(r.fecha),huellaRegistro:String(r.huella_registro),integra:cadenaIntegra,
    vigente:cadenaIntegra&&cambios.length===0,cambios,registro:cadenaIntegra?registro:null};
  });
  if(!cadenaIntegra){
   for(const h of historial){h.vigente=false;if(!h.cambios.includes('HISTORIAL_CONSTANCIAS_INVALIDO'))h.cambios.push('HISTORIAL_CONSTANCIAS_INVALIDO');}
   informe.hallazgos.push({codigo:'HISTORIAL_CONSTANCIAS_INVALIDO',nivel:'BLOQUEANTE',referencias:[{tipo:'SOLICITUD_C3C11',id:e.solicitud.id}]});informe.completoTecnicamente=false;
  }
  return {informe,historial,version,cadenaIntegra,puedeRegistrar:puedeGestionar&&cadenaIntegra&&permisoConstancia(usuarioId,e.solicitud.politica?.responsables,ctx.elegibles.map(u=>u.id))};
 });
 return {...ambito(empresaId,entidadId,ejercicioId),evaluaciones,usuarioId,aviso:AVISO_PRECONTABLE,aprobacionFormalHabilitada:false};
}

export async function consultarPrecontable(empresaId:number,entidadId:number,ejercicioId:number,usuarioId:number){
 validarIds(empresaId,entidadId,ejercicioId,usuarioId);
 const c=await getPool().getConnection();
 try{await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');await c.query('START TRANSACTION READ ONLY');const d=await evaluarTx(c,empresaId,entidadId,ejercicioId,usuarioId);await c.commit();return d;}
 catch(e){await c.rollback();throw e;}finally{c.release();}
}
export type EvaluacionPrecontable=Awaited<ReturnType<typeof consultarPrecontable>>;

export async function registrarConstancia(empresaId:number,entidadId:number,ejercicioId:number,actor:Actor,input:unknown){
 validarIds(empresaId,entidadId,ejercicioId,actor.id);
 const d=constanciaEntrada.parse(input),c=await getPool().getConnection();
 try{
  await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');await c.beginTransaction();
  await bloquearGestion(c,empresaId,entidadId,ejercicioId,actor,[]);
  await c.query('SELECT version FROM cont_regularizacion_evidencias WHERE empresa_id=? AND entidad_id=? AND ejercicio_id=? FOR UPDATE',[empresaId,entidadId,ejercicioId]);
  await c.query('SELECT version FROM cont_regularizacion_evaluaciones WHERE empresa_id=? AND entidad_id=? AND ejercicio_id=? FOR UPDATE',[empresaId,entidadId,ejercicioId]);
  if(!await permisoGestion(c,empresaId,actor.id))throw new AccesoContable('Se requiere permiso explícito de gestión contable.',403);
  const huellaSolicitud=huellaCondiciones({...ambito(empresaId,entidadId,ejercicioId),actorId:actor.id,...d});
  const [prev]=await c.query<RowDataPacket[]>('SELECT version,huella_solicitud FROM cont_regularizacion_evaluaciones WHERE empresa_id=? AND entidad_id=? AND clave_idempotencia=?',[empresaId,entidadId,d.claveIdempotencia]);
  if(prev[0]){if(prev[0].huella_solicitud!==huellaSolicitud)throw new AccesoContable('Idempotencia utilizada por otro contenido o actor.',409);await c.commit();return {version:Number(prev[0].version),reutilizado:true,aprobacionFormal:false};}
  const actual=await evaluarTx(c,empresaId,entidadId,ejercicioId,actor.id),e=actual.evaluaciones.find(e=>e.informe.solicitudId===d.solicitudId);
  if(!e)throw new AccesoContable('Solicitud no disponible en este ámbito.',404);
  if(!e.cadenaIntegra)throw new AccesoContable('Historial de constancias inconsistente.',409);
  if(!e.puedeRegistrar)throw new AccesoContable('Solo el revisor designado, distinto del preparador, con todos los responsables autorizados.',403);
  if(e.version!==d.versionEsperada||e.informe.huellaIntegral!==d.huellaIntegral)throw new AccesoContable('Cambió la evaluación o su historial. Vuelve a consultar.',409);
  const version=e.version+1;
  const registro:Registro={contrato:'C3C13-CONSTANCIA-1',...ambito(empresaId,entidadId,ejercicioId),solicitudId:d.solicitudId,version,
   anterior:e.historial.at(-1)?.huellaRegistro??null,actorId:actor.id,justificacion:d.justificacion,informe:e.informe};
  const huellaRegistro=huellaCondiciones(registro);
  await c.execute('INSERT INTO cont_regularizacion_evaluaciones(empresa_id,entidad_id,ejercicio_id,solicitud_id,version,registro_json,huella_registro,huella_integral,clave_idempotencia,huella_solicitud,creado_por) VALUES (?,?,?,?,?,?,?,?,?,?,?)',[empresaId,entidadId,ejercicioId,d.solicitudId,version,JSON.stringify(registro),huellaRegistro,d.huellaIntegral,d.claveIdempotencia,huellaSolicitud,actor.id]);
  await registrarAuditoriaTx(c,{empresaId,usuario:actor.username,modulo:'contabilidad',accion:'regularizacion_constancia_precontable',detalle:JSON.stringify({entidadId,ejercicioId,solicitudId:d.solicitudId,version,actorId:actor.id,huellaRegistro,huellaIntegral:d.huellaIntegral,justificacion:d.justificacion,completoTecnicamente:e.informe.completoTecnicamente,aprobacionFormal:false,contabilizado:false})});
  await c.commit();return {version,reutilizado:false,aprobacionFormal:false};
 }catch(e){await c.rollback();throw e;}finally{c.release();}
}
