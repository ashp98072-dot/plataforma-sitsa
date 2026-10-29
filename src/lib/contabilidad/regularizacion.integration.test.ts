import type {Pool,RowDataPacket} from 'mysql2/promise';
import {beforeAll,afterAll,describe,it,expect,vi} from 'vitest';
const lab=vi.hoisted(()=>({pool:undefined as unknown as Pick<Pool,'getConnection'>}));
vi.mock('@/lib/db',()=>({getPool:()=>{if(!lab.pool)throw Error('BD_OPERATIVA_PROHIBIDA');return lab.pool;}}));
vi.mock('@/lib/load-env',()=>({loadRuntimeEnv:()=>{throw Error('ENV_PROHIBIDO');}}));
import {manifestC3c2,poolC3c2} from '../../../scripts/ci/c3c2/connection.mjs';
import {crearEjercicioConPeriodos} from './calendario';import {simularRegularizacion} from './regularizacion';
const manifest=process.env.C3C2_MANIFEST;let pool:ReturnType<typeof poolC3c2>;const ejercicios:number[]=[];
async function sql(text:string,params:(number|string)[]=[]){const c=await pool.getConnection();try{return (await c.query<RowDataPacket[]>(text,params))[0];}finally{c.release();}}
async function asiento(id:number,fecha:string,cuenta:number,debe:string,haber:string,estado='Registrado'){
 await sql('INSERT INTO cont_asientos(id,empresa_id,entidad_id,fecha,numero,estado) VALUES (?,7,9,?,?,?)',[id,fecha,'LAB-'+id,estado]);
 await sql('INSERT INTO cont_asiento_detalle(empresa_id,entidad_id,asiento_id,cuenta_id,debe,haber) VALUES (7,9,?,?,?,?),(7,9,?,5,?,?)',[id,cuenta,debe,haber,id,haber,debe]);
}
describe.skipIf(!manifest).sequential('C3C6 MariaDB temporal verificada',()=>{
 beforeAll(async()=>{
  pool=poolC3c2(manifestC3c2(manifest!));lab.pool=pool;
  for(const year of [2030,2031,2032]){await crearEjercicioConPeriodos(7,'lab-41',{entidadId:9,usuarioId:41,admin:false},{codigo:'LAB'+year,fechaInicio:year+'-01-01',fechaFin:year+'-02-28',periodos:[{codigo:'ENE'+year,fechaInicio:year+'-01-01',fechaFin:year+'-01-31'},{codigo:'FEB'+year,fechaInicio:year+'-02-01',fechaFin:year+'-02-28'}]});}
  ejercicios.push(...(await sql('SELECT id FROM cont_ejercicios ORDER BY id')).map(r=>Number(r.id)));
  await sql("UPDATE cont_cuentas SET tipo=CASE id WHEN 1 THEN 'Gasto' WHEN 2 THEN 'Ingreso' ELSE tipo END WHERE empresa_id=7 AND entidad_id=9");
  await sql("INSERT INTO cont_cuentas(id,empresa_id,entidad_id,codigo,activa,nombre,tipo,nivel) VALUES (5,7,9,'CAJA',1,'Caja ficticia','Activo',1),(6,7,9,'VACIA',1,'Gasto sin movimientos','Gasto',1)");
  await asiento(201,'2030-01-01',2,'0.00','100.00');await asiento(202,'2030-02-28',1,'40.00','0.00');await asiento(203,'2029-12-31',2,'0.00','900.00');await asiento(204,'2030-03-01',2,'0.00','500.00');await asiento(205,'2030-02-01',2,'0.00','999.00','Borrador');
  await asiento(211,'2031-01-01',2,'0.00','10.00');await asiento(212,'2031-02-28',1,'25.00','0.00');
  await asiento(221,'2032-01-01',2,'0.30','0.00');await asiento(222,'2032-02-28',1,'0.00','0.10');
  await sql("INSERT INTO cont_asientos(id,empresa_id,entidad_id,fecha,numero,estado) VALUES (299,7,10,'2030-01-01','OTRO','Registrado')");await sql('INSERT INTO cont_asiento_detalle(empresa_id,entidad_id,asiento_id,cuenta_id,debe,haber) VALUES (7,10,299,3,9999,0),(7,10,299,4,0,9999)');
 },120000);
 afterAll(async()=>{await pool?.end();});
 it('utilidad solo del ejercicio, historico separado, borrador y futuro excluidos',async()=>{
  const d=await simularRegularizacion(7,9,ejercicios[0]);expect(d.calculo).toMatchObject({ingresos:'100.00',gastos:'40.00',resultadoPreliminar:'60.00'});
  expect(d.calculo.nominales.find(c=>c.cuentaId===2)).toMatchObject({saldoHistoricoAnterior:'-900.00',inversaIndicativa:{debe:'100.00',haber:'0.00'}});expect(d.calculo.nominales.find(c=>c.cuentaId===6)?.saldoEjercicio).toBe('0.00');
  expect(d.estado).toBe('INCOMPLETA');expect(d.cuentaResultado).toBeNull();expect(d.propuestaCompleta).toBeNull();expect(d.bloqueantes).toContain('PERIODOS_NO_CERRADOS');
 });
 it('perdida y ejercicios distintos no se mezclan',async()=>{expect((await simularRegularizacion(7,9,ejercicios[1])).calculo.resultadoPreliminar).toBe('-15.00');});
 it('saldos contrarios conservan signo y precision',async()=>{const d=await simularRegularizacion(7,9,ejercicios[2]);expect(d.calculo).toMatchObject({ingresos:'-0.30',gastos:'-0.10',resultadoPreliminar:'-0.20'});expect(d.advertencias).toContain('SALDOS_NOMINALES_CONTRARIOS');});
 it('empresa o libro ajenos no revelan ejercicios ni importes',async()=>{await expect(simularRegularizacion(8,11,ejercicios[0])).rejects.toMatchObject({status:404});await expect(simularRegularizacion(7,10,ejercicios[0])).rejects.toMatchObject({status:404});await expect(simularRegularizacion(8,9,ejercicios[0])).rejects.toMatchObject({status:404});});
 it('consulta no modifica cuentas, asientos, periodos, control ni auditoria',async()=>{
  const tablas=['cont_cuentas','cont_asientos','cont_asiento_detalle','cont_ejercicios','cont_periodos','cont_control_libro','auditoria','cont_control_diagnosticos'];const antes=await Promise.all(tablas.map(t=>sql('SELECT * FROM '+t+' ORDER BY 1')));await simularRegularizacion(7,9,ejercicios[0]);expect(await Promise.all(tablas.map(t=>sql('SELECT * FROM '+t+' ORDER BY 1')))).toEqual(antes);
 });
 it('una sola instantanea incluso si cambian cuentas concurrentemente',async()=>{
  let changed=false;lab.pool={getConnection:async()=>{const c=await pool.getConnection();return new Proxy(c,{get(target,key){if(key==='query')return async(...args:unknown[])=>{const result=await c.query(...args as Parameters<typeof c.query>);if(!changed&&String(args[0]).includes('FROM cont_ejercicios')){changed=true;await sql("UPDATE cont_cuentas SET tipo='Capital' WHERE id=2 AND empresa_id=7 AND entidad_id=9");}return result;};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});}};
  try{const d=await simularRegularizacion(7,9,ejercicios[0]);expect(changed).toBe(true);expect(d.calculo.ingresos).toBe('100.00');expect(d.diagnostico.asientos.registrados).toBe(2);}finally{lab.pool=pool;await sql("UPDATE cont_cuentas SET tipo='Ingreso' WHERE id=2 AND empresa_id=7 AND entidad_id=9");}
 });
 it('asientos descuadrados producen resultado no confiable',async()=>{await sql('UPDATE cont_asiento_detalle SET debe=39.99 WHERE asiento_id=202 AND cuenta_id=1');const d=await simularRegularizacion(7,9,ejercicios[0]);expect(d.bloqueantes).toContain('ASIENTOS_DESCUADRADOS');expect(d.resultadoConfiable).toBe(false);expect(d.propuestaCompleta).toBeNull();});
 it('clasificacion insuficiente y nominal inactiva son bloqueantes visibles',async()=>{await sql("UPDATE cont_cuentas SET tipo='Otro' WHERE id=6");await sql('UPDATE cont_cuentas SET activa=0 WHERE id=2');const d=await simularRegularizacion(7,9,ejercicios[0]);expect(d.bloqueantes).toEqual(expect.arrayContaining(['CLASIFICACION_INSUFICIENTE','NOMINALES_INACTIVAS_CON_SALDO','CUENTA_RESULTADO_NO_CONFIGURADA']));expect(d.calculo.sinClasificar[0].cuentaId).toBe(6);expect(d.resultadoConfiable).toBe(false);});
});
