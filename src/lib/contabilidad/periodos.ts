import type {PoolConnection,RowDataPacket,ResultSetHeader} from 'mysql2/promise';
import {getPool} from '@/lib/db';
import {registrarAuditoriaTx} from '@/lib/auditoria';
import {bloquearAmbito} from './ambito';
import {bloquearControl} from './periodos-control';
import {accionPeriodo,ErrorPeriodo,exigirTransicion,permisoPeriodo,CAPACIDADES_PERIODOS,type AccionPeriodo,type CapacidadPeriodo} from './periodos-contrato';
import {diagnosticoCalendario,evidenciaMovimientos,huellaPeriodo,REGLAS_PERIODOS,type MovimientoPeriodo,type PeriodoControl} from './periodos-evidencia';

type Actor={id:number;username:string};
type Contexto={empresaId:number;entidadId:number;actor:Actor};
const scope=(ctx:Contexto)=>[ctx.empresaId,ctx.entidadId];
async function filas(c:PoolConnection,sql:string,params:(string|number|boolean|null)[]=[]){const [r]=await c.query<RowDataPacket[]>(sql,params);return r;}
async function ejecutar(c:PoolConnection,sql:string,params:(string|number|boolean|null)[]=[]){const [r]=await c.execute<ResultSetHeader>(sql,params);return r;}

async function autorizar(c:PoolConnection,ctx:Contexto,actorId:number,cap:CapacidadPeriodo,operator=true){
  // Sin defaults ni bypass Admin. Leer usuario y asignación actuales, no caché de permisos.
  const users=await filas(c,'SELECT id,username,rol_global,activo,acceso_todas_empresas FROM usuarios WHERE id=? LOCK IN SHARE MODE',[actorId]);
  const u=users[0];if(!u?.activo)throw new ErrorPeriodo('SIN_PERMISO','Usuario no disponible.',403);
  const emp=await filas(c,'SELECT activa,modulos_json FROM empresas WHERE id=?',[ctx.empresaId]);
  if(!emp[0]?.activa)throw new ErrorPeriodo('SIN_PERMISO','Empresa no disponible.',403);
  let mods:string[]=[];try{mods=typeof emp[0].modulos_json==='string'?JSON.parse(emp[0].modulos_json):emp[0].modulos_json??[];}catch{throw new ErrorPeriodo('SIN_PERMISO','Módulos no disponibles.',403);}
  if(mods.length&&!mods.includes('contabilidad'))throw new ErrorPeriodo('SIN_PERMISO','Contabilidad no habilitada.',403);
  if(u.rol_global!=='Admin'&&!u.acceso_todas_empresas&&!(await filas(c,'SELECT usuario_id FROM usuario_empresa WHERE usuario_id=? AND empresa_id=? LOCK IN SHARE MODE',[actorId,ctx.empresaId])).length)throw new ErrorPeriodo('SIN_PERMISO','Sin acceso a esta empresa.',403);
  const grants=await filas(c,'SELECT modulo FROM usuario_modulo WHERE usuario_id=? AND empresa_id IS NULL AND puede_ver=1 AND modulo IN (?,?) LOCK IN SHARE MODE',[actorId,permisoPeriodo(cap),'contabilidad_calendario_ver']);
  if(!grants.some(g=>g.modulo===permisoPeriodo(cap))||!grants.some(g=>g.modulo==='contabilidad_calendario_ver'))throw new ErrorPeriodo('SIN_PERMISO','Falta capacidad explícita de períodos.',403);
  if(operator&&!(await filas(c,'SELECT usuario_id FROM cont_periodos_operadores WHERE empresa_id=? AND entidad_id=? AND usuario_id=? AND capacidad=? AND activo=1 FOR UPDATE',[...scope(ctx),actorId,cap])).length)throw new ErrorPeriodo('SIN_OPERADOR','Usuario no habilitado como operador de este libro.',403);
  return u;
}
async function contenido(c:PoolConnection,ctx:Contexto){
  const periodos=await filas(c,`SELECT p.*,DATE_FORMAT(p.fecha_inicio,'%Y-%m-%d') fechaInicio,DATE_FORMAT(p.fecha_fin,'%Y-%m-%d') fechaFin,
    DATE_FORMAT(e.fecha_inicio,'%Y-%m-%d') inicioEjercicio,DATE_FORMAT(e.fecha_fin,'%Y-%m-%d') finEjercicio
    FROM cont_periodos p JOIN cont_ejercicios e ON e.empresa_id=p.empresa_id AND e.entidad_id=p.entidad_id AND e.id=p.ejercicio_id
    WHERE p.empresa_id=? AND p.entidad_id=? ORDER BY p.ejercicio_id,p.orden FOR UPDATE`,scope(ctx)) as PeriodoControl[];
  const movimientos=await filas(c,`SELECT a.id asiento,DATE_FORMAT(a.fecha,'%Y-%m-%d') fecha,a.estado,d.id detalle,d.cuenta_id cuenta,
    CAST(d.debe AS CHAR) debe,CAST(d.haber AS CHAR) haber,
    CASE WHEN d.empresa_id=a.empresa_id AND d.entidad_id=a.entidad_id AND cc.empresa_id=a.empresa_id AND cc.entidad_id=a.entidad_id THEN 1 ELSE 0 END ambitoValido
    FROM cont_asientos a LEFT JOIN cont_asiento_detalle d ON d.asiento_id=a.id LEFT JOIN cont_cuentas cc ON cc.id=d.cuenta_id
    WHERE a.empresa_id=? AND a.entidad_id=? ORDER BY a.id,d.id FOR UPDATE`,scope(ctx)) as MovimientoPeriodo[];
  return {periodos,movimientos};
}
async function diagnosticar(c:PoolConnection,ctx:Contexto,control:RowDataPacket){
  const data=await contenido(c,ctx);const resultado=diagnosticoCalendario(data.periodos,data.movimientos);
  const empty=await filas(c,'SELECT e.id FROM cont_ejercicios e LEFT JOIN cont_periodos p ON p.empresa_id=e.empresa_id AND p.entidad_id=e.entidad_id AND p.ejercicio_id=e.id WHERE e.empresa_id=? AND e.entidad_id=? GROUP BY e.id HAVING COUNT(p.id)=0',scope(ctx));
  if(empty.length)resultado.bloqueantes.push('EJERCICIO_SIN_PERIODOS');
  const orphan=await filas(c,'SELECT d.id FROM cont_asiento_detalle d LEFT JOIN cont_asientos a ON a.id=d.asiento_id WHERE d.empresa_id=? AND d.entidad_id=? AND (a.id IS NULL OR a.empresa_id<>d.empresa_id OR a.entidad_id<>d.entidad_id) LIMIT 1',scope(ctx));
  if(orphan.length)resultado.bloqueantes.push('DETALLE_HUERFANO');
  return {...resultado,huella:huellaPeriodo(data),version:Number(control.version),cambios:String(control.cambios),operadoresVersion:Number(control.operadores_version)};
}

export async function operarPeriodo(ctx:Contexto,input:unknown){
  const action=accionPeriodo.parse(input) as AccionPeriodo;
  const c=await getPool().getConnection();
  try{
    await c.beginTransaction();
    await bloquearAmbito(c,ctx.empresaId,{entidadId:ctx.entidadId,usuarioId:ctx.actor.id,admin:false},true);
    const control=await bloquearControl(c,ctx.empresaId,ctx.entidadId);
    let solicitud:RowDataPacket|undefined;
    if(action.accion==='resolver')solicitud=(await filas(c,'SELECT * FROM cont_periodos_solicitudes WHERE empresa_id=? AND entidad_id=? AND id=? FOR UPDATE',[...scope(ctx),action.solicitudId]))[0];
    const cap:CapacidadPeriodo=action.accion==='resolver'?(solicitud?.tipo==='ACTIVAR'?'activar_aprobar':'reabrir_aprobar'):action.accion==='operador'?'operadores':action.accion;
    const actor=await autorizar(c,ctx,ctx.actor.id,cap,cap!=='operadores');
    const hash=huellaPeriodo(action);
    const previous=(await filas(c,'SELECT actor_id,huella,detalle FROM cont_periodos_historial WHERE empresa_id=? AND entidad_id=? AND operacion=? FOR UPDATE',[...scope(ctx),action.operacion]))[0];
    if(previous){
      if(previous.huella!==hash||previous.actor_id!==ctx.actor.id)throw new ErrorPeriodo('OPERACION_REUTILIZADA','Identificador utilizado con otro contenido.');
      await c.commit();return JSON.parse(previous.detalle);
    }
    let result:Record<string,unknown>;
    const periodId='periodoId' in action?action.periodoId:solicitud?.periodo_id;
    const p=periodId?(await filas(c,'SELECT * FROM cont_periodos WHERE empresa_id=? AND entidad_id=? AND id=? FOR UPDATE',[...scope(ctx),periodId]))[0]:undefined;
    if('periodoId' in action&&(!p||Number(p.version)!==action.version))throw new ErrorPeriodo('VERSION_CAMBIADA','Período no disponible o versión cambiada.');
    if(action.accion==='operador'){
      if(action.usuarioId===ctx.actor.id)throw new ErrorPeriodo('AUTOASIGNACION','No se permite modificar la propia habilitación.',403);
      if(action.activo)await autorizar(c,ctx,action.usuarioId,action.capacidad,false);
      await ejecutar(c,`INSERT INTO cont_periodos_operadores (empresa_id,entidad_id,usuario_id,capacidad,activo,otorgado_por)
        VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE activo=VALUES(activo),otorgado_por=VALUES(otorgado_por),actualizado_en=CURRENT_TIMESTAMP`,[...scope(ctx),action.usuarioId,action.capacidad,Number(action.activo),ctx.actor.id]);
      await ejecutar(c,'UPDATE cont_control_libro SET operadores_version=operadores_version+1 WHERE empresa_id=? AND entidad_id=?',scope(ctx));
      result={usuarioId:action.usuarioId,capacidad:action.capacidad,activo:action.activo};
    }else if(action.accion==='diagnosticar'){
      const d=await diagnosticar(c,ctx,control);
      const saved=await ejecutar(c,`INSERT INTO cont_control_diagnosticos (empresa_id,entidad_id,actor_id,version_control,cambios,operadores_version,reglas,bloqueantes,advertencias,hallazgos,huella) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,[...scope(ctx),ctx.actor.id,d.version,d.cambios,d.operadoresVersion,REGLAS_PERIODOS,d.bloqueantes.length,d.advertencias.length,JSON.stringify(d),d.huella]);
      result={diagnosticoId:saved.insertId,...d};
    }else if(action.accion==='abrir'||action.accion==='cerrar'){
      exigirTransicion(p!.estado,action.accion);
      if(action.accion==='abrir'){
        const data=await contenido(c,ctx);
        if(diagnosticoCalendario(data.periodos,[]).bloqueantes.length)throw new ErrorPeriodo('INTEGRIDAD','El calendario no permite abrir el período.');
      }
      let cierreId:number|undefined;
      if(action.accion==='cerrar'){
        if(control.estado!=='ACTIVO')throw new ErrorPeriodo('CONTROL_INACTIVO','No se cierra sin control efectivo del libro.');
        const data=await contenido(c,ctx);const diag=diagnosticoCalendario(data.periodos,[]);
        if(diag.bloqueantes.length)throw new ErrorPeriodo('INTEGRIDAD','Calendario inconsistente.');
        const dates=data.periodos.find(x=>x.id===p!.id)!;
        const evidence={...evidenciaMovimientos(data.movimientos.filter(r=>r.fecha>=dates.fechaInicio&&r.fecha<=dates.fechaFin)),
          periodo:{id:p!.id,codigo:dates.codigo,fechaInicio:dates.fechaInicio,fechaFin:dates.fechaFin},revision:Number(p!.revision_cierre)+1,versionPeriodo:Number(p!.version),actorId:ctx.actor.id};
        const saved=await ejecutar(c,'INSERT INTO cont_periodos_cierres (empresa_id,entidad_id,periodo_id,revision,actor_id,motivo,huella,evidencia) VALUES (?,?,?,?,?,?,?,?)',[...scope(ctx),p!.id,Number(p!.revision_cierre)+1,ctx.actor.id,action.motivo,huellaPeriodo(evidence),JSON.stringify(evidence)]);cierreId=saved.insertId;
      }
      const next=action.accion==='abrir'?'ABIERTO':'CERRADO';
      await ejecutar(c,'UPDATE cont_periodos SET estado=?,version=version+1,revision_cierre=revision_cierre+? WHERE empresa_id=? AND entidad_id=? AND id=?',[next,action.accion==='cerrar'?1:0,...scope(ctx),p!.id]);
      result={periodoId:p!.id,antes:p!.estado,estado:next,version:Number(p!.version)+1,cierreId};
    }else if(action.accion==='reabrir_solicitar'||action.accion==='activar_solicitar'){
      if(action.accion==='reabrir_solicitar'){
        if(control.estado!=='ACTIVO')throw new ErrorPeriodo('CONTROL_INACTIVO','Control no activo.');
        exigirTransicion(p!.estado,'reabrir');
        // El lock estable de empresa/libro ya serializa a todos los solicitantes.
        // También bloquean las pendientes antiguas: deben resolverse por el flujo
        // autorizado de rechazo, conservando motivo, auditoría y dos actores.
        const pendientes=await filas(c,"SELECT id FROM cont_periodos_solicitudes WHERE empresa_id=? AND entidad_id=? AND tipo='REABRIR' AND periodo_id=? AND estado='PENDIENTE' ORDER BY id LIMIT 1 FOR UPDATE",[...scope(ctx),p!.id]);
        if(pendientes.length)throw new ErrorPeriodo('SOLICITUD_PENDIENTE','Ya existe una solicitud de reapertura pendiente para este período. Resuélvela antes de crear otra.');
      }else{
        if(control.estado!=='NO_ACTIVADO')throw new ErrorPeriodo('YA_ACTIVO','El control ya está activo.');
        const d=(await filas(c,'SELECT * FROM cont_control_diagnosticos WHERE empresa_id=? AND entidad_id=? AND id=? FOR UPDATE',[...scope(ctx),action.diagnosticoId]))[0];
        const current=await diagnosticar(c,ctx,control);
        if(!d||d.reglas!==REGLAS_PERIODOS||d.huella!==current.huella||Number(d.bloqueantes)!==0||current.bloqueantes.length||String(d.cambios)!==current.cambios||Number(d.operadores_version)!==current.operadoresVersion||Number(d.version_control)!==current.version)throw new ErrorPeriodo('DIAGNOSTICO_INVALIDO','Repite el diagnóstico; existen cambios o bloqueantes.');
        if(current.advertencias.length&&!action.aceptaHistoria)throw new ErrorPeriodo('ADVERTENCIAS','Debes aceptar explícitamente las advertencias históricas.');
      }
      const activating=action.accion==='activar_solicitar';
      const saved=await ejecutar(c,`INSERT INTO cont_periodos_solicitudes (empresa_id,entidad_id,tipo,periodo_id,diagnostico_id,solicitante_id,motivo,acepta_historia,version_objeto,operadores_version) VALUES (?,?,?,?,?,?,?,?,?,?)`,[...scope(ctx),activating?'ACTIVAR':'REABRIR',activating?null:p!.id,activating?action.diagnosticoId:null,ctx.actor.id,action.motivo,activating?Number(action.aceptaHistoria):0,activating?control.version:p!.version,control.operadores_version]);
      result={solicitudId:saved.insertId,estado:'PENDIENTE',version:0};
    }else{
      if(!solicitud||solicitud.estado!=='PENDIENTE'||Number(solicitud.version)!==action.version)throw new ErrorPeriodo('SOLICITUD_CAMBIADA','Solicitud no disponible o resuelta.');
      if(solicitud.solicitante_id===ctx.actor.id)throw new ErrorPeriodo('AUTOAPROBACION','Se requieren dos personas distintas.',403);
      await autorizar(c,ctx,solicitud.solicitante_id,solicitud.tipo==='ACTIVAR'?'activar_solicitar':'reabrir_solicitar');
      let transicion:Record<string,unknown>|undefined;
      if(action.aprobar){
        if(Number(solicitud.operadores_version)!==Number(control.operadores_version))throw new ErrorPeriodo('VERSION_CAMBIADA','Cambió la habilitación de operadores.');
        if(solicitud.tipo==='ACTIVAR'){
          const d=(await filas(c,'SELECT * FROM cont_control_diagnosticos WHERE empresa_id=? AND entidad_id=? AND id=? FOR UPDATE',[...scope(ctx),solicitud.diagnostico_id]))[0];
          const current=await diagnosticar(c,ctx,control);
          if(control.estado!=='NO_ACTIVADO'||Number(control.version)!==Number(solicitud.version_objeto)||!d||d.huella!==current.huella||d.reglas!==REGLAS_PERIODOS||String(d.cambios)!==current.cambios||current.bloqueantes.length||current.advertencias.length&&!solicitud.acepta_historia)throw new ErrorPeriodo('DIAGNOSTICO_INVALIDO','El diagnóstico ya no permite activar.');
          await ejecutar(c,"UPDATE cont_control_libro SET estado='ACTIVO',version=version+1,activado_en=CURRENT_TIMESTAMP WHERE empresa_id=? AND entidad_id=?",scope(ctx));
          transicion={objeto:'CONTROL',antes:control.estado,estado:'ACTIVO',versionAntes:Number(control.version),version:Number(control.version)+1,diagnosticoId:solicitud.diagnostico_id};
        }else{
          if(!p||control.estado!=='ACTIVO'||Number(p.version)!==Number(solicitud.version_objeto))throw new ErrorPeriodo('VERSION_CAMBIADA','Cambió el período.');
          exigirTransicion(p.estado,'reabrir');
          await ejecutar(c,"UPDATE cont_periodos SET estado='ABIERTO',version=version+1 WHERE empresa_id=? AND entidad_id=? AND id=?",[...scope(ctx),p.id]);
          transicion={objeto:'PERIODO',periodoId:p.id,antes:p.estado,estado:'ABIERTO',versionAntes:Number(p.version),version:Number(p.version)+1};
        }
      }
      await ejecutar(c,'UPDATE cont_periodos_solicitudes SET estado=?,version=version+1,decisor_id=?,motivo_resolucion=?,resuelto_en=CURRENT_TIMESTAMP WHERE empresa_id=? AND entidad_id=? AND id=?',[action.aprobar?'EJECUTADA':'RECHAZADA',ctx.actor.id,action.motivo,...scope(ctx),solicitud.id]);
      result={solicitudId:solicitud.id,estado:action.aprobar?'EJECUTADA':'RECHAZADA',version:Number(solicitud.version)+1,solicitanteId:solicitud.solicitante_id,decisorId:ctx.actor.id,transicion};
    }
    await ejecutar(c,'INSERT INTO cont_periodos_historial (empresa_id,entidad_id,operacion,huella,actor_id,accion,motivo,detalle) VALUES (?,?,?,?,?,?,?,?)',[...scope(ctx),action.operacion,hash,ctx.actor.id,action.accion,action.motivo,JSON.stringify(result)]);
    await registrarAuditoriaTx(c,{empresaId:ctx.empresaId,usuario:String(actor.username),modulo:'contabilidad',accion:`periodos_${action.accion}`,detalle:JSON.stringify({entidadId:ctx.entidadId,actorId:ctx.actor.id,operacion:action.operacion,motivo:action.motivo,...result})});
    await c.commit();return result;
  }catch(e){await c.rollback();throw e;}finally{c.release();}
}

export async function consultarControlPeriodo(empresaId:number,entidadId:number,actorId:number){
  const c=await getPool().getConnection();
  try{
    await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');await c.query('START TRANSACTION READ ONLY');
    if(!(await filas(c,'SELECT id FROM cont_entidades WHERE empresa_id=? AND id=?',[empresaId,entidadId])).length)throw new ErrorPeriodo('LIBRO_NO_DISPONIBLE','Libro no disponible.',404);
    const params=[empresaId,entidadId];
    const control=(await filas(c,'SELECT * FROM cont_control_libro WHERE empresa_id=? AND entidad_id=?',params))[0]??{estado:'NO_ACTIVADO',version:0};
    const periodos=await filas(c,"SELECT id,ejercicio_id,codigo,estado,version,revision_cierre,DATE_FORMAT(fecha_inicio,'%Y-%m-%d') fechaInicio,DATE_FORMAT(fecha_fin,'%Y-%m-%d') fechaFin FROM cont_periodos WHERE empresa_id=? AND entidad_id=? ORDER BY fecha_inicio",params);
    const solicitudes=await filas(c,'SELECT * FROM cont_periodos_solicitudes WHERE empresa_id=? AND entidad_id=? ORDER BY id DESC LIMIT 100',params);
    const historial=await filas(c,'SELECT * FROM cont_periodos_historial WHERE empresa_id=? AND entidad_id=? ORDER BY id DESC LIMIT 100',params);
    const cierres=await filas(c,'SELECT id,periodo_id,revision,actor_id,motivo,huella,creado_en FROM cont_periodos_cierres WHERE empresa_id=? AND entidad_id=? ORDER BY id DESC LIMIT 100',params);
    const operadores=await filas(c,'SELECT usuario_id,capacidad,activo FROM cont_periodos_operadores WHERE empresa_id=? AND entidad_id=?',params);
    const grants=await filas(c,'SELECT modulo FROM usuario_modulo WHERE usuario_id=? AND empresa_id IS NULL AND puede_ver=1',[actorId]);
    const capacidades=CAPACIDADES_PERIODOS.filter(cap=>grants.some(g=>g.modulo===permisoPeriodo(cap))&&(cap==='operadores'||operadores.some(o=>o.usuario_id===actorId&&o.capacidad===cap&&o.activo)));
    await c.commit();return {control,periodos,solicitudes,historial,cierres,operadores,capacidades};
  }catch(e){await c.rollback();throw e;}finally{c.release();}
}
export async function consultarEvidenciaPeriodo(empresaId:number,entidadId:number,cierreId:number){
  const c=await getPool().getConnection();
  try{
    const rows=await filas(c,'SELECT * FROM cont_periodos_cierres WHERE empresa_id=? AND entidad_id=? AND id=?',[empresaId,entidadId,cierreId]);
    if(!rows.length)throw new ErrorPeriodo('CIERRE_NO_DISPONIBLE','Evidencia no disponible.',404);
    const row=rows[0];return {...row,evidencia:JSON.parse(row.evidencia),advertencia:'Evidencia de esta revisión; no representa necesariamente los datos vigentes después de una reapertura.'};
  }finally{c.release();}
}
