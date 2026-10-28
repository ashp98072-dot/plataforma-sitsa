import fs from 'node:fs';import crypto from 'node:crypto';
import type {Pool,RowDataPacket} from 'mysql2/promise';
import {beforeAll,afterAll,describe,it,expect,vi} from 'vitest';
const lab=vi.hoisted(()=>({pool:undefined as unknown as Pick<Pool,'getConnection'>}));
vi.mock('@/lib/db',()=>({getPool:()=>{if(!lab.pool)throw Error('BD_NORMAL_PROHIBIDA');return lab.pool;},query:()=>{throw Error('QUERY_GLOBAL_PROHIBIDA');},execute:()=>{throw Error('EXECUTE_GLOBAL_PROHIBIDO');}}));
vi.mock('@/lib/load-env',()=>({loadRuntimeEnv:()=>{throw Error('ENV_PROHIBIDO');}}));
import {manifestC3c2,poolC3c2} from '../../../../scripts/ci/c3c2/connection.mjs';
import {crearEjercicioConPeriodos} from '../calendario';import {registrarAsiento} from '../asientos';
import {operarPeriodo} from '../periodos';import {CAPACIDADES_PERIODOS,permisoPeriodo} from '../periodos-contrato';
import {libroDiario,libroMayor,balanceComprobacion} from './reportes';import {exportarXlsx} from './exportar';
const manifest=process.env.C3C2_MANIFEST;
let pool:ReturnType<typeof poolC3c2>,periodo=0,febrero=0;
const base=()=>({motivo:'Prueba sintética de reportes por período contable',operacion:crypto.randomUUID()});
const ctx=(id=41)=>({empresaId:7,entidadId:9,actor:{id,username:'lab-'+id}});
async function filas(sql:string,params:(number|string)[]=[]){const c=await pool.getConnection();try{return (await c.query<RowDataPacket[]>(sql,params))[0];}finally{c.release();}}
const asiento=(numero:string,fecha:string)=>registrarAsiento(7,'lab-41',{numero,fecha,lineas:[{cuentaId:1,debe:12.34},{cuentaId:2,haber:12.34}]},{entidadId:9,usuarioId:41,admin:false});
describe.skipIf(!manifest).sequential('C3C3 real: reportes por período con pipe e identidad verificadas',()=>{
 beforeAll(async()=>{
  const m=manifestC3c2(manifest!);pool=poolC3c2(m);lab.pool=pool;
  const c=await pool.getConnection();try{
   for(const uid of [41,42])for(const modulo of ['contabilidad_calendario_ver',...CAPACIDADES_PERIODOS.map(permisoPeriodo)])await c.execute('INSERT INTO usuario_modulo VALUES (?,NULL,?,1)',[uid,modulo]);
   await c.execute('INSERT INTO cont_control_libro(empresa_id,entidad_id) VALUES (7,9)');
   for(const uid of [41,42])for(const cap of CAPACIDADES_PERIODOS)await c.execute('INSERT INTO cont_periodos_operadores(empresa_id,entidad_id,usuario_id,capacidad,activo,otorgado_por) VALUES (7,9,?,?,1,?)',[uid,cap,uid===41?42:41]);
  }finally{c.release();}
  await crearEjercicioConPeriodos(7,'lab-41',{entidadId:9,usuarioId:41,admin:false},{codigo:'LAB2030',fechaInicio:'2030-01-01',fechaFin:'2030-02-28',periodos:[{codigo:'ENE',fechaInicio:'2030-01-01',fechaFin:'2030-01-31'},{codigo:'FEB',fechaInicio:'2030-02-01',fechaFin:'2030-02-28'}]});
  const ps=await filas('SELECT id FROM cont_periodos ORDER BY id');periodo=ps[0].id;febrero=ps[1].id;
  await operarPeriodo(ctx(),{...base(),accion:'abrir',periodoId:periodo,version:0});
  await operarPeriodo(ctx(),{...base(),accion:'abrir',periodoId:febrero,version:0});
  await asiento('ENE-INICIO','2030-01-01');await asiento('ENE-FIN','2030-01-31');await asiento('FEB-FUERA','2030-02-01');
  const diag=await operarPeriodo(ctx(),{...base(),accion:'diagnosticar'});
  const solicitud=await operarPeriodo(ctx(),{...base(),accion:'activar_solicitar',diagnosticoId:diag.diagnosticoId,aceptaHistoria:true});
  await operarPeriodo(ctx(42),{...base(),accion:'resolver',solicitudId:solicitud.solicitudId,version:0,aprobar:true});
 },120000);
 afterAll(async()=>{await pool?.end();});
 it('Diario incluye ambos extremos y excluye otro período',async()=>{
  const d=await libroDiario(7,9,{periodoId:periodo});expect(d.asientos.map(a=>a.numero)).toEqual(['ENE-INICIO','ENE-FIN']);expect(d.totalesRango.debe).toBe('24.68');expect(d.periodoSeleccionado).toMatchObject({codigo:'ENE',estado:'ABIERTO',version:1});
 });
 it('Mayor y balance usan el mismo rango e importes exactos del diario',async()=>{
  const mayor=await libroMayor(7,9,1,{periodoId:periodo}),balance=await balanceComprobacion(7,9,{periodoId:periodo});
  expect(mayor.movimientos).toHaveLength(2);expect(mayor.totales.debe).toBe('24.68');expect(balance.totales.totalDebe).toBe('24.68');expect(balance.totales.totalHaber).toBe('24.68');
 });
 it('rechaza empresa y libro ajenos y cuenta de otro libro',async()=>{
  await expect(libroDiario(8,11,{periodoId:periodo})).rejects.toMatchObject({status:404});await expect(libroDiario(7,10,{periodoId:periodo})).rejects.toMatchObject({status:404});await expect(libroMayor(7,9,3,{periodoId:periodo})).rejects.toMatchObject({status:404});
 });
 it('rechaza combinar fechas manuales e identificador incluso llamando al servicio',async()=>{await expect(libroDiario(7,9,{periodoId:periodo,desde:'2030-01-01'})).rejects.toMatchObject({status:400});});
 it('consulta y Excel no escriben auditoría ni cambian períodos',async()=>{
  const antes=await filas('SELECT * FROM cont_periodos ORDER BY id'),auditoria=await filas('SELECT COUNT(*) n FROM auditoria');
  const data=await libroDiario(7,9,{periodoId:periodo});expect((await exportarXlsx('diario',data)).length).toBeGreaterThan(100);
  expect(await filas('SELECT * FROM cont_periodos ORDER BY id')).toEqual(antes);expect(await filas('SELECT COUNT(*) n FROM auditoria')).toEqual(auditoria);
 });
 it('cierre concurrente conserva lectura consistente y bloquea nuevos asientos sin impedir reportes',async()=>{
  const [d]=await Promise.all([libroDiario(7,9,{periodoId:periodo}),operarPeriodo(ctx(),{...base(),accion:'cerrar',periodoId:periodo,version:1})]);
  const rev=d.trazabilidadPeriodo.revisiones.find(p=>p.id===periodo)!;expect(d.periodoSeleccionado?.version).toBe(Number(rev.version));expect(d.periodoSeleccionado?.estado).toBe(rev.estado);expect([1,2]).toContain(d.periodoSeleccionado?.version);
  await expect(asiento('NO-PASA','2030-01-15')).rejects.toMatchObject({codigo:'PERIODO_NO_ABIERTO'});
  expect((await libroDiario(7,9,{periodoId:periodo})).periodoSeleccionado).toMatchObject({estado:'CERRADO',revisionCierre:1,version:2});
 });
 it('reapertura cambia revisión visible sin alterar la evidencia de cierre anterior',async()=>{
  const antes=await filas('SELECT huella,evidencia FROM cont_periodos_cierres');
  const s=await operarPeriodo(ctx(),{...base(),accion:'reabrir_solicitar',periodoId:periodo,version:2});await operarPeriodo(ctx(42),{...base(),accion:'resolver',solicitudId:s.solicitudId,version:0,aprobar:true});
  expect((await libroDiario(7,9,{periodoId:periodo})).periodoSeleccionado).toMatchObject({estado:'ABIERTO',version:3,revisionCierre:1});expect(await filas('SELECT huella,evidencia FROM cont_periodos_cierres')).toEqual(antes);
 });
 it('fechas manuales mantienen resultados existentes sin asignar períodos a asientos',async()=>{
  const antes=await filas('SELECT * FROM cont_asientos ORDER BY id');const d=await libroDiario(7,9,{desde:'2030-02-01',hasta:'2030-02-28'});expect(d.periodoSeleccionado).toBeNull();expect(d.asientos.map(a=>a.numero)).toEqual(['FEB-FUERA']);expect(await filas('SELECT * FROM cont_asientos ORDER BY id')).toEqual(antes);
  const m=manifestC3c2(manifest!);fs.writeFileSync(m.runDir+'/reportes-c3c3-summary.json',JSON.stringify({pruebas:8,empresaId:7,entidadId:9,periodo,febrero}));
 });
});
