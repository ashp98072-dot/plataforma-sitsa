import type {Pool,RowDataPacket} from 'mysql2/promise';
import {beforeAll,afterAll,describe,it,expect,vi} from 'vitest';
const lab=vi.hoisted(()=>({pool:undefined as unknown as Pick<Pool,'getConnection'>}));
vi.mock('@/lib/db',()=>({getPool:()=>{if(!lab.pool)throw Error('BD_OPERATIVA_PROHIBIDA');return lab.pool;}}));
vi.mock('@/lib/load-env',()=>({loadRuntimeEnv:()=>{throw Error('ENV_PROHIBIDO');}}));
import {manifestC3c2,poolC3c2} from '../../../scripts/ci/c3c2/connection.mjs';
import {crearEjercicioConPeriodos} from './calendario';
import {diagnosticarCierre} from './cierre-diagnostico';
const manifest=process.env.C3C2_MANIFEST;
let pool:ReturnType<typeof poolC3c2>,ejercicio=0;
async function sql(text:string,params:(number|string)[]=[]){const c=await pool.getConnection();try{return (await c.query<RowDataPacket[]>(text,params))[0];}finally{c.release();}}
describe.skipIf(!manifest).sequential('C3C5 MariaDB temporal con identidad verificada',()=>{
 beforeAll(async()=>{
  pool=poolC3c2(manifestC3c2(manifest!));lab.pool=pool;
  await crearEjercicioConPeriodos(7,'lab-41',{entidadId:9,usuarioId:41,admin:false},{codigo:'LAB2030',fechaInicio:'2030-01-01',fechaFin:'2030-02-28',periodos:[{codigo:'ENE',fechaInicio:'2030-01-01',fechaFin:'2030-01-31'},{codigo:'FEB',fechaInicio:'2030-02-01',fechaFin:'2030-02-28'}]});
  ejercicio=Number((await sql('SELECT id FROM cont_ejercicios'))[0].id);
  await sql("INSERT INTO cont_asientos(id,empresa_id,entidad_id,fecha,numero,estado) VALUES (101,7,9,'2030-01-01','REG','Registrado'),(102,7,9,'2030-02-28','BOR','Borrador'),(103,7,10,'2030-01-01','OTRO','Registrado'),(104,7,9,'2029-12-31','ANT','Registrado')");
  await sql('INSERT INTO cont_asiento_detalle(empresa_id,entidad_id,asiento_id,cuenta_id,debe,haber) VALUES (7,9,101,1,0.30,0),(7,9,101,2,0,0.30),(7,9,102,1,99,0),(7,10,103,3,999,0),(7,9,104,1,10,0),(7,9,104,2,0,10)');
 },120000);
 afterAll(async()=>{await pool?.end();});
 it('ejercicio configurado muestra control no activado, borrador e historia anterior',async()=>{
  const d=await diagnosticarCierre(7,9,ejercicio);expect(d).toMatchObject({asientos:{registrados:1,noRegistrados:1,debe:'0.30',haber:'0.30'},asientosAnteriores:1});
  expect(d.bloqueantes).toContain('PERIODOS_NO_CERRADOS');expect(d.bloqueantes).toContain('CONTROL_NO_ACTIVO');expect(d.advertencias).toContain('HISTORIA_ANTERIOR_AL_EJERCICIO');
 });
 it('no revela ejercicios de otra empresa o libro',async()=>{
  await expect(diagnosticarCierre(8,11,ejercicio)).rejects.toMatchObject({status:404});await expect(diagnosticarCierre(7,10,ejercicio)).rejects.toMatchObject({status:404});await expect(diagnosticarCierre(8,9,ejercicio)).rejects.toMatchObject({status:404});
 });
 it('identifica periodos abiertos',async()=>{await sql("UPDATE cont_periodos SET estado='ABIERTO' WHERE empresa_id=7 AND entidad_id=9");const d=await diagnosticarCierre(7,9,ejercicio);expect(d.abiertos).toHaveLength(2);});
 it('periodos cerrados y control activo no certifican regularizacion',async()=>{
  await sql("UPDATE cont_periodos SET estado='CERRADO' WHERE empresa_id=7 AND entidad_id=9");
  await sql("INSERT INTO cont_control_libro(empresa_id,entidad_id,estado,activado_en) VALUES (7,9,'ACTIVO',CURRENT_TIMESTAMP)");
  const d=await diagnosticarCierre(7,9,ejercicio);expect(d.bloqueantes).toEqual([]);expect(d.advertencias).toContain('REGULARIZACION_NO_VERIFICADA');expect(d.estado).toBe('SIN_BLOQUEANTES_TECNICOS');
 });
 it('diagnostico no modifica datos, control ni auditoria',async()=>{
  const tablas=['cont_ejercicios','cont_periodos','cont_control_libro','cont_asientos','cont_asiento_detalle','auditoria'];
  const antes=await Promise.all(tablas.map(t=>sql('SELECT * FROM '+t+' ORDER BY 1')));
  await diagnosticarCierre(7,9,ejercicio);await diagnosticarCierre(7,9,ejercicio);
  expect(await Promise.all(tablas.map(t=>sql('SELECT * FROM '+t+' ORDER BY 1')))).toEqual(antes);
 });
 it('mantiene instantanea consistente durante una reapertura concurrente',async()=>{
  let changed=false;
  lab.pool={getConnection:async()=>{
   const c=await pool.getConnection();
   return new Proxy(c,{get(target,key){if(key==='query')return async(...args:unknown[])=>{
    const result=await c.query(...args as Parameters<typeof c.query>);
    if(!changed&&String(args[0]).includes('FROM cont_ejercicios')){changed=true;await sql("UPDATE cont_periodos SET estado='ABIERTO' WHERE empresa_id=7 AND entidad_id=9");}
    return result;
   };const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
  }};
  try{const d=await diagnosticarCierre(7,9,ejercicio);expect(changed).toBe(true);expect(d.abiertos).toHaveLength(0);expect(d.periodos.every(p=>p.estado==='CERRADO')).toBe(true);}
  finally{lab.pool=pool;await sql("UPDATE cont_periodos SET estado='CERRADO' WHERE empresa_id=7 AND entidad_id=9");}
 });
 it('descuadre individual e importes incompatibles se detectan con centavos exactos',async()=>{
  await sql("INSERT INTO cont_asientos(id,empresa_id,entidad_id,fecha,numero,estado) VALUES (105,7,9,'2030-02-28','MAL','Registrado')");
  await sql('INSERT INTO cont_asiento_detalle(empresa_id,entidad_id,asiento_id,cuenta_id,debe,haber) VALUES (7,9,105,1,0.10,0.20),(7,9,105,2,0.10,0)');
  const d=await diagnosticarCierre(7,9,ejercicio);expect(d.asientos.diferencia).toBe('0.00');expect(d.asientos.integridad.total).toBe(1);
  await sql('UPDATE cont_asiento_detalle SET debe=0.09 WHERE asiento_id=105 AND cuenta_id=2');
  const mal=await diagnosticarCierre(7,9,ejercicio);expect(mal.asientos.diferencia).toBe('-0.01');expect(mal.asientos.descuadrados.muestra[0].numero).toBe('MAL');
 });
 it('cuenta ausente y detalle huerfano no quedan ocultos',async()=>{
  await sql('INSERT INTO cont_asiento_detalle(empresa_id,entidad_id,asiento_id,cuenta_id,debe,haber) VALUES (7,9,101,NULL,0,0),(7,9,NULL,1,0.10,0)');
  const d=await diagnosticarCierre(7,9,ejercicio);expect(d.detallesHuerfanosLibro).toBe(1);expect(d.bloqueantes).toContain('DETALLES_HUERFANOS_LIBRO');expect(d.asientos.integridad.total).toBe(2);
 });
 it('reapertura es visible en una nueva instantanea sin modificarla',async()=>{await sql("UPDATE cont_periodos SET estado='ABIERTO',version=version+1 WHERE codigo='ENE'");const d=await diagnosticarCierre(7,9,ejercicio);expect(d.abiertos).toHaveLength(1);expect(d.bloqueantes).toContain('PERIODOS_NO_CERRADOS');});
});
