import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
import type {Pool,PoolConnection,RowDataPacket} from 'mysql2/promise';
import {beforeAll,afterAll,describe,it,expect,vi} from 'vitest';
const lab=vi.hoisted(()=>({pool:undefined as unknown as Pick<Pool,'getConnection'>,failAudit:false}));
vi.mock('@/lib/db',()=>({getPool:()=>{if(!lab.pool)throw Error('Pool normal prohibido');return lab.pool;},query:()=>{throw Error('Consulta global prohibida');},execute:()=>{throw Error('Escritura global prohibida');}}));
vi.mock('@/lib/load-env',()=>({loadRuntimeEnv:()=>{throw Error('Configuración externa prohibida');}}));
vi.mock('@/lib/auditoria',async original=>{const real=await original<typeof import('@/lib/auditoria')>();return {...real,registrarAuditoriaTx:async(...args:Parameters<typeof real.registrarAuditoriaTx>)=>{if(lab.failAudit)throw Error('Fallo de auditoría sintético');return real.registrarAuditoriaTx(...args);}};});
import {manifestC3c2,poolC3c2} from '../../../scripts/ci/c3c2/connection.mjs';
import {operarPeriodo,consultarControlPeriodo,consultarEvidenciaPeriodo} from './periodos';import {CAPACIDADES_PERIODOS,permisoPeriodo} from './periodos-contrato';
import {crearEjercicioConPeriodos} from './calendario';import {registrarAsiento} from './asientos';
const manifest=process.env.C3C2_MANIFEST;
const ctx=(id=41,entidadId=9,empresaId=7)=>({empresaId,entidadId,actor:{id,username:`lab-${id}`}});
const base=()=>({operacion:crypto.randomUUID(),motivo:'Motivo de laboratorio ficticio y verificable'});
let pool:ReturnType<typeof poolC3c2>,periodo=0,segundo=0;
async function rows(sql:string,args:(number|string)[]=[]){const c=await pool.getConnection();try{const [r]=await c.query<RowDataPacket[]>(sql,args);return r;}finally{c.release();}}
const version=async()=>Number((await rows('SELECT version FROM cont_periodos WHERE id=?',[periodo]))[0].version);
const asiento=(numero:string,fecha='2030-02-01')=>registrarAsiento(7,'lab-41',{numero,fecha,lineas:[{cuentaId:1,debe:1},{cuentaId:2,haber:1}]},{entidadId:9,usuarioId:41,admin:false});
describe.skipIf(!manifest).sequential('C3C2 real: exclusivamente pipe temporal verificado',()=>{
  beforeAll(async()=>{
    const m=manifestC3c2(manifest!);pool=poolC3c2(m);lab.pool=pool as unknown as Pick<Pool,'getConnection'>;
    const c=await pool.getConnection();try{
      for(const uid of [41,42]){
        for(const cap of ['contabilidad_calendario_ver',...CAPACIDADES_PERIODOS.map(permisoPeriodo)])await c.execute('INSERT INTO usuario_modulo VALUES (?,NULL,?,1)',[uid,cap]);
      }
      await c.execute('INSERT INTO cont_control_libro(empresa_id,entidad_id) VALUES(7,9),(7,10)');
      // Bootstrap exclusivamente ficticio, nunca se ejecuta en migración o producción.
      for(const book of [9,10])for(const uid of [41,42])for(const cap of CAPACIDADES_PERIODOS)await c.execute('INSERT INTO cont_periodos_operadores(empresa_id,entidad_id,usuario_id,capacidad,activo,otorgado_por) VALUES(7,?,?,?,1,?)',[book,uid,cap,uid===41?42:41]);
    }finally{c.release();}
    await crearEjercicioConPeriodos(7,'lab-41',{entidadId:9,usuarioId:41,admin:false},{codigo:'LAB2030',fechaInicio:'2030-01-01',fechaFin:'2030-12-31',periodos:[{codigo:'A',fechaInicio:'2030-01-01',fechaFin:'2030-06-30'},{codigo:'B',fechaInicio:'2030-07-01',fechaFin:'2030-12-31'}]});
    const ps=await rows('SELECT id FROM cont_periodos ORDER BY id');periodo=Number(ps[0].id);segundo=Number(ps[1].id);
  });
  afterAll(async()=>{lab.failAudit=false;await pool?.end();});
  it('control desactivado por defecto conserva escritura histórica sin inferir períodos',async()=>{
    await asiento('HISTORIA','2029-01-01');expect((await rows('SELECT estado FROM cont_control_libro WHERE empresa_id=7 AND entidad_id=9'))[0].estado).toBe('NO_ACTIVADO');
    expect((await rows('SELECT estado FROM cont_periodos WHERE id=?',[periodo]))[0].estado).toBe('CONFIGURADO');
  });
  it('Admin sin grants y cruce de empresa/libro son rechazados; no autoasignación',async()=>{
    for(const scope of [ctx(43),ctx(41,11),ctx(41,11,8),ctx(41,10)])await expect(operarPeriodo(scope,{...base(),accion:'abrir',periodoId:periodo,version:0})).rejects.toThrow();
    await expect(operarPeriodo(ctx(),{...base(),accion:'operador',usuarioId:41,capacidad:'cerrar',activo:true})).rejects.toMatchObject({codigo:'AUTOASIGNACION'});
  });
  it('apertura múltiple, motivo y versiones; no cierre sin control activo',async()=>{
    await operarPeriodo(ctx(),{...base(),accion:'abrir',periodoId:periodo,version:0});
    await operarPeriodo(ctx(),{...base(),accion:'abrir',periodoId:segundo,version:0});
    await expect(operarPeriodo(ctx(),{...base(),accion:'cerrar',periodoId:periodo,version:1})).rejects.toMatchObject({codigo:'CONTROL_INACTIVO'});
    expect((await rows("SELECT COUNT(*) n FROM cont_periodos WHERE estado='ABIERTO'"))[0].n).toBe(2);
  });
  it('activación requiere diagnóstico actual y aprobación distinta; historia permanece intacta',async()=>{
    const d=await operarPeriodo(ctx(),{...base(),accion:'diagnosticar'});
    expect(d.bloqueantes).toEqual([]);expect(d.advertencias).toContain('HISTORIA_SIN_COBERTURA');
    const s=await operarPeriodo(ctx(),{...base(),accion:'activar_solicitar',diagnosticoId:d.diagnosticoId,aceptaHistoria:true});
    await expect(operarPeriodo(ctx(),{...base(),accion:'resolver',solicitudId:s.solicitudId,version:0,aprobar:true})).rejects.toMatchObject({codigo:'AUTOAPROBACION'});
    const approved=await operarPeriodo(ctx(42),{...base(),accion:'resolver',solicitudId:s.solicitudId,version:0,aprobar:true});
    expect(approved).toMatchObject({solicitanteId:41,decisorId:42,transicion:{antes:'NO_ACTIVADO',estado:'ACTIVO'}});
    expect((await rows("SELECT DATE_FORMAT(fecha,'%Y-%m-%d') fecha FROM cont_asientos WHERE numero='HISTORIA'"))[0].fecha).toBe('2029-01-01');
    await expect(asiento('FUERA','2029-02-01')).rejects.toMatchObject({codigo:'PERIODO_AMBIGUO'});
  });
  it('cierre conserva evidencia; registro cerrado rechazado; idempotencia sin duplicar',async()=>{
    await asiento('ABIERTO');const action={...base(),accion:'cerrar',periodoId:periodo,version:await version()};
    const first=await operarPeriodo(ctx(),action);const second=await operarPeriodo(ctx(),action);expect(second).toEqual(first);
    await expect(asiento('CERRADO')).rejects.toMatchObject({codigo:'PERIODO_NO_ABIERTO'});
    const e=JSON.parse((await rows('SELECT evidencia FROM cont_periodos_cierres WHERE id=?',[Number(first.cierreId)]))[0].evidencia);expect(e.asientos).toBe(1);expect(e.lineas).toBe(2);
    expect((await rows('SELECT estado FROM cont_periodos WHERE id=?',[segundo]))[0].estado).toBe('ABIERTO');
  });
  it('reapertura con dos actores conserva cierre anterior y permite nuevos asientos',async()=>{
    const s=await operarPeriodo(ctx(),{...base(),accion:'reabrir_solicitar',periodoId:periodo,version:await version()});
    await expect(operarPeriodo(ctx(),{...base(),accion:'resolver',solicitudId:s.solicitudId,version:0,aprobar:true})).rejects.toMatchObject({codigo:'AUTOAPROBACION'});
    await operarPeriodo(ctx(42),{...base(),accion:'resolver',solicitudId:s.solicitudId,version:0,aprobar:true});await asiento('REABIERTO');
    expect((await rows('SELECT COUNT(*) n FROM cont_periodos_cierres'))[0].n).toBe(1);
  });
  it('fallo de auditoría revierte estado, revisión y evidencia de cierre',async()=>{
    const before=await version();lab.failAudit=true;
    try{await expect(operarPeriodo(ctx(),{...base(),accion:'cerrar',periodoId:periodo,version:before})).rejects.toThrow('auditoría');}finally{lab.failAudit=false;}
    expect(await version()).toBe(before);expect((await rows('SELECT COUNT(*) n FROM cont_periodos_cierres'))[0].n).toBe(1);
  });
  it('registro que posee primero el lock confirma antes de cierre concurrente',async()=>{
    const c=await pool.getConnection();await c.beginTransaction();
    try{
      await c.query('SELECT id FROM empresas WHERE id=7 FOR UPDATE');
      const close=operarPeriodo(ctx(),{...base(),accion:'cerrar',periodoId:periodo,version:await version()});
      const {registrarAsientoTx}=await import('./asientos');
      await registrarAsientoTx(c as unknown as PoolConnection,7,'lab-41',{numero:'CONCURRENTE',fecha:'2030-02-01',lineas:[{cuentaId:1,debe:1},{cuentaId:2,haber:1}]},{entidadId:9,usuarioId:41,admin:false});await c.commit();
      await close;await expect(asiento('DESPUES')).rejects.toMatchObject({codigo:'PERIODO_NO_ABIERTO'});
      const e=JSON.parse((await rows('SELECT evidencia FROM cont_periodos_cierres ORDER BY id DESC LIMIT 1'))[0].evidencia);expect(e.asientos).toBe(3);
    }catch(e){await c.rollback();throw e;}finally{c.release();}
  });
  it('FK compuesta y CHECK rechazan autoaprobación y cruces reales',async()=>{
    const c=await pool.getConnection();try{
      await expect(c.execute("INSERT INTO cont_periodos_cierres(empresa_id,entidad_id,periodo_id,revision,actor_id,motivo,huella,evidencia) VALUES(7,10,?,1,41,?,?,'{}')",[periodo,'Motivo ficticio suficientemente largo','a'.repeat(64)])).rejects.toThrow();
      const s=await operarPeriodo(ctx(),{...base(),accion:'reabrir_solicitar',periodoId:periodo,version:await version()});
      await expect(c.execute("UPDATE cont_periodos_solicitudes SET estado='EJECUTADA',decisor_id=solicitante_id,motivo_resolucion=?,resuelto_en=CURRENT_TIMESTAMP WHERE id=?",['Motivo ficticio suficientemente largo',s.solicitudId])).rejects.toThrow();
    }finally{c.release();}
    const m=manifestC3c2(manifest!);fs.writeFileSync(path.join(m.runDir,'synthetic-proof.json'),JSON.stringify({engine:m.engine,company:7,book:9,actors:[41,42],periodo,segundo,sourceCommit:'b3a04d27',historicalPreserved:true},null,2));
  });
  it('diagnóstico obsoleto, revocación y rollback de activación no habilitan el segundo libro',async()=>{
    await crearEjercicioConPeriodos(7,'lab-41',{entidadId:10,usuarioId:41,admin:false},{codigo:'LAB2031',fechaInicio:'2031-01-01',fechaFin:'2031-12-31',periodos:[{codigo:'A',fechaInicio:'2031-01-01',fechaFin:'2031-12-31'}]});
    const p2=(await rows('SELECT id FROM cont_periodos WHERE entidad_id=10'))[0].id;
    await operarPeriodo(ctx(41,10),{...base(),accion:'abrir',periodoId:p2,version:0});
    let d=await operarPeriodo(ctx(41,10),{...base(),accion:'diagnosticar'});
    await registrarAsiento(7,'lab-41',{numero:'CAMBIO_DIAG',fecha:'2031-01-01',lineas:[{cuentaId:3,debe:1},{cuentaId:4,haber:1}]},{entidadId:10,usuarioId:41,admin:false});
    await expect(operarPeriodo(ctx(41,10),{...base(),accion:'activar_solicitar',diagnosticoId:d.diagnosticoId,aceptaHistoria:true})).rejects.toMatchObject({codigo:'DIAGNOSTICO_INVALIDO'});
    d=await operarPeriodo(ctx(41,10),{...base(),accion:'diagnosticar'});
    let s=await operarPeriodo(ctx(41,10),{...base(),accion:'activar_solicitar',diagnosticoId:d.diagnosticoId,aceptaHistoria:true});
    await operarPeriodo(ctx(41,10),{...base(),accion:'operador',usuarioId:42,capacidad:'activar_aprobar',activo:false});
    await expect(operarPeriodo(ctx(42,10),{...base(),accion:'resolver',solicitudId:s.solicitudId,version:0,aprobar:true})).rejects.toMatchObject({codigo:'SIN_OPERADOR'});
    await operarPeriodo(ctx(41,10),{...base(),accion:'operador',usuarioId:42,capacidad:'activar_aprobar',activo:true});
    await expect(operarPeriodo(ctx(42,10),{...base(),accion:'resolver',solicitudId:s.solicitudId,version:0,aprobar:true})).rejects.toMatchObject({codigo:'VERSION_CAMBIADA'});
    d=await operarPeriodo(ctx(41,10),{...base(),accion:'diagnosticar'});
    s=await operarPeriodo(ctx(41,10),{...base(),accion:'activar_solicitar',diagnosticoId:d.diagnosticoId,aceptaHistoria:true});
    const action={...base(),accion:'resolver',solicitudId:s.solicitudId,version:0,aprobar:true};
    lab.failAudit=true;try{await expect(operarPeriodo(ctx(42,10),action)).rejects.toThrow('auditoría');}finally{lab.failAudit=false;}
    expect((await rows('SELECT estado FROM cont_control_libro WHERE entidad_id=10'))[0].estado).toBe('NO_ACTIVADO');
    expect((await rows('SELECT estado FROM cont_periodos_solicitudes WHERE id=?',[Number(s.solicitudId)]))[0].estado).toBe('PENDIENTE');
    await operarPeriodo(ctx(42,10),action);
  });
  it('dos cierres concurrentes producen una sola nueva revisión',async()=>{
    const s=await operarPeriodo(ctx(),{...base(),accion:'reabrir_solicitar',periodoId:periodo,version:await version()});
    await operarPeriodo(ctx(42),{...base(),accion:'resolver',solicitudId:s.solicitudId,version:0,aprobar:true});
    const v=await version();const results=await Promise.allSettled([41,42].map(uid=>operarPeriodo(ctx(uid),{...base(),accion:'cerrar',periodoId:periodo,version:v})));
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(results.filter(r=>r.status==='rejected')).toHaveLength(1);
    expect((await rows('SELECT COUNT(*) n FROM cont_periodos_cierres WHERE periodo_id=?',[periodo]))[0].n).toBe(3);
  });
  it('rollback de registro revierte cabecera, detalles y contador del libro',async()=>{
    const before=(await rows('SELECT cambios FROM cont_control_libro WHERE entidad_id=10'))[0].cambios;
    lab.failAudit=true;try{
      await expect(registrarAsiento(7,'lab-41',{numero:'ROLLBACK',fecha:'2031-01-01',lineas:[{cuentaId:3,debe:1},{cuentaId:4,haber:1}]},{entidadId:10,usuarioId:41,admin:false})).rejects.toThrow('auditoría');
    }finally{lab.failAudit=false;}
    expect((await rows("SELECT COUNT(*) n FROM cont_asientos WHERE numero='ROLLBACK'"))[0].n).toBe(0);
    expect((await rows('SELECT cambios FROM cont_control_libro WHERE entidad_id=10'))[0].cambios).toBe(before);
  });
  it('cierre que obtiene primero el lock rechaza al registrador concurrente',async()=>{
    const id=(await rows('SELECT id FROM cont_periodos WHERE entidad_id=10'))[0].id;
    let acquired!:()=>void,release!:()=>void;const ready=new Promise<void>(r=>{acquired=r;}),gate=new Promise<void>(r=>{release=r;});let first=true;
    lab.pool={getConnection:async()=>{
      const c=await pool.getConnection();
      return new Proxy(c,{get(target,key){
        if(key==='query')return async(...args:unknown[])=>{
          const result=await Reflect.apply(target.query,target,args);
          if(first&&String(args[0]).includes('SELECT id FROM empresas')){first=false;acquired();await gate;}
          return result;
        };
        const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
      }});
    }} as Pick<Pool,'getConnection'>;
    try{
      const close=operarPeriodo(ctx(41,10),{...base(),accion:'cerrar',periodoId:id,version:1});
      await ready;
      const posting=registrarAsiento(7,'lab-41',{numero:'PERDEDOR',fecha:'2031-02-01',lineas:[{cuentaId:3,debe:1},{cuentaId:4,haber:1}]},{entidadId:10,usuarioId:41,admin:false}).then(()=>null,e=>e);
      release();await close;expect(await posting).toMatchObject({codigo:'PERIODO_NO_ABIERTO'});
    }finally{release();lab.pool=pool as unknown as Pick<Pool,'getConnection'>;}
  });
  it('consulta real de control y evidencia se mantiene dentro del libro solicitado',async()=>{
    const view=await consultarControlPeriodo(7,9,41);expect(view.control.estado).toBe('ACTIVO');expect(view.periodos).toHaveLength(2);expect(view.cierres).toHaveLength(3);
    const evidence=await consultarEvidenciaPeriodo(7,9,Number(view.cierres[0].id));expect(evidence.evidencia.reglas).toBe('C3C2-1');
    await expect(consultarEvidenciaPeriodo(7,10,Number(view.cierres[0].id))).rejects.toMatchObject({codigo:'CIERRE_NO_DISPONIBLE'});
  });
});
