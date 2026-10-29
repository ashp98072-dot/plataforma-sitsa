import type {Pool,RowDataPacket} from 'mysql2/promise';
import {beforeAll,afterAll,describe,it,expect,vi} from 'vitest';
const lab=vi.hoisted(()=>({pool:undefined as unknown as Pick<Pool,'getConnection'>}));
vi.mock('@/lib/db',()=>({getPool:()=>{if(!lab.pool)throw Error('BD_OPERATIVA_PROHIBIDA');return lab.pool;}}));
vi.mock('@/lib/load-env',()=>({loadRuntimeEnv:()=>{throw Error('ENV_PROHIBIDO');}}));
import {manifestC3c2,poolC3c2} from '../../../scripts/ci/c3c2/connection.mjs';
import {crearEjercicioConPeriodos} from './calendario';
import {simularPropuestaRegularizacion} from './propuesta-regularizacion';
const manifest=process.env.C3C2_MANIFEST;let pool:ReturnType<typeof poolC3c2>;const ejercicios:number[]=[];
async function sql(text:string,params:(number|string)[]=[]){const c=await pool.getConnection();try{return (await c.query<RowDataPacket[]>(text,params))[0];}finally{c.release();}}
async function asiento(id:number,fecha:string,cuenta:number,debe:string,haber:string,estado='Registrado'){
 await sql('INSERT INTO cont_asientos(id,empresa_id,entidad_id,fecha,numero,estado) VALUES (?,7,9,?,?,?)',[id,fecha,'LAB-'+id,estado]);
 await sql('INSERT INTO cont_asiento_detalle(empresa_id,entidad_id,asiento_id,cuenta_id,debe,haber) VALUES (7,9,?,?,?,?),(7,9,?,6,?,?)',[id,cuenta,debe,haber,id,haber,debe]);
}
describe.skipIf(!manifest).sequential('C3C8 MariaDB temporal verificada',()=>{
 beforeAll(async()=>{
  pool=poolC3c2(manifestC3c2(manifest!));lab.pool=pool;
  await sql("UPDATE cont_cuentas SET tipo=CASE id WHEN 1 THEN 'Ingreso' WHEN 2 THEN 'Gasto' ELSE tipo END WHERE empresa_id=7 AND entidad_id=9");
  await sql("INSERT INTO cont_cuentas(id,empresa_id,entidad_id,codigo,nombre,tipo,activa,nivel) VALUES (5,7,9,'RES','Capital ficticio','Capital',1,1),(6,7,9,'CAJA','Caja ficticia','Activo',1,1),(7,7,9,'VACIA','Gasto vacio','Gasto',1,1)");
  for(const year of [2030,2031])await crearEjercicioConPeriodos(7,'lab-41',{entidadId:9,usuarioId:41,admin:false},{codigo:'LAB'+year,fechaInicio:year+'-01-01',fechaFin:year+'-01-31',periodos:[{codigo:'ENE'+year,fechaInicio:year+'-01-01',fechaFin:year+'-01-31'}]});
  ejercicios.push(...(await sql('SELECT id FROM cont_ejercicios ORDER BY id')).map(r=>Number(r.id)));
  await sql("UPDATE cont_periodos SET estado='CERRADO'");
  await sql("INSERT INTO cont_control_libro(empresa_id,entidad_id,estado,activado_en) VALUES (7,9,'ACTIVO',CURRENT_TIMESTAMP) ON DUPLICATE KEY UPDATE estado='ACTIVO',activado_en=CURRENT_TIMESTAMP");
  await sql("INSERT INTO cont_cuentas_rol(empresa_id,entidad_id,rol,cuenta_id) VALUES (7,9,'RESULTADO_EJERCICIO',5)");
  await asiento(201,'2030-01-01',1,'0.00','1500.00');await asiento(202,'2030-01-31',2,'900.00','0.00');await asiento(203,'2029-12-31',1,'0.00','999.00');await asiento(204,'2030-01-02',1,'0.00','999.00','Borrador');
  await asiento(211,'2031-01-01',1,'0.00','40.00');await asiento(212,'2031-01-31',2,'100.00','0.00');
 },120000);
 afterAll(async()=>{await pool?.end();});
 it('utilidad exacta, historia separada y borradores excluidos',async()=>{const d=await simularPropuestaRegularizacion(7,9,ejercicios[0]);expect(d.bloqueantesTecnicos).toEqual([]);expect(d.calculo).toMatchObject({ingresos:'1500.00',gastos:'900.00',resultadoPreliminar:'600.00'});expect(d.propuestaSimulada?.totales).toMatchObject({debe:'1500.00',haber:'1500.00',diferencia:'0.00',cuadra:true});expect(d.propuestaSimulada?.lineas.at(-1)).toMatchObject({cuentaId:5,haber:'600.00'});expect(d.propuestaCompleta).toBeNull();expect(d.listaParaContabilizar).toBe(false);});
 it('perdida de otro ejercicio conserva signo',async()=>{const d=await simularPropuestaRegularizacion(7,9,ejercicios[1]);expect(d.propuestaSimulada?.lineas.at(-1)).toMatchObject({cuentaId:5,debe:'60.00',haber:'0.00'});expect(d.aritmeticamenteBalanceada).toBe(true);});
 it('empresa y libro ajenos no revelan datos',async()=>{for(const [e,l] of [[8,11],[7,10],[8,9]])await expect(simularPropuestaRegularizacion(e,l,ejercicios[0])).rejects.toMatchObject({status:404});});
 it('no escribe asientos, configuracion, periodos ni auditoria',async()=>{const tablas=['cont_cuentas','cont_cuentas_rol','cont_asientos','cont_asiento_detalle','cont_ejercicios','cont_periodos','cont_control_libro','auditoria','cont_control_diagnosticos'];const snapshot=()=>Promise.all(tablas.map(t=>sql('SELECT * FROM '+t+' ORDER BY 1')));const antes=await snapshot();await simularPropuestaRegularizacion(7,9,ejercicios[0]);expect(await snapshot()).toEqual(antes);});
 it('una instantanea conserva catalogo y cuenta de resultado ante cambio concurrente',async()=>{
  let changed=false;lab.pool={getConnection:async()=>{const c=await pool.getConnection();return new Proxy(c,{get(target,key){if(key==='query')return async(...args:unknown[])=>{const result=await c.query(...args as Parameters<typeof c.query>);if(!changed&&String(args[0]).includes('FROM cont_ejercicios')){changed=true;await sql('UPDATE cont_cuentas SET activa=0 WHERE id=5');}return result;};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});}};
  try{const d=await simularPropuestaRegularizacion(7,9,ejercicios[0]);expect(changed).toBe(true);expect(d.cuentaResultado?.id).toBe(5);expect(d.aritmeticamenteBalanceada).toBe(true);}finally{lab.pool=pool;await sql('UPDATE cont_cuentas SET activa=1 WHERE id=5');}
 });
 it('periodos abiertos bloquean',async()=>{await sql("UPDATE cont_periodos SET estado='ABIERTO' WHERE ejercicio_id=?",[ejercicios[0]]);try{const d=await simularPropuestaRegularizacion(7,9,ejercicios[0]);expect(d.bloqueantesTecnicos).toContain('PERIODOS_NO_CERRADOS');expect(d.propuestaSimulada).toBeNull();}finally{await sql("UPDATE cont_periodos SET estado='CERRADO'");}});
 it('cuenta configurada inactiva bloquea',async()=>{await sql('UPDATE cont_cuentas SET activa=0 WHERE id=5');try{const d=await simularPropuestaRegularizacion(7,9,ejercicios[0]);expect(d.bloqueantesTecnicos).toContain('CUENTA_RESULTADO_INVALIDA');expect(d.propuestaSimulada).toBeNull();}finally{await sql('UPDATE cont_cuentas SET activa=1 WHERE id=5');}});
 it('asiento descuadrado bloquea',async()=>{await sql('UPDATE cont_asiento_detalle SET debe=899.99 WHERE asiento_id=202 AND cuenta_id=2');try{const d=await simularPropuestaRegularizacion(7,9,ejercicios[0]);expect(d.bloqueantesTecnicos).toContain('ASIENTOS_DESCUADRADOS');expect(d.propuestaSimulada).toBeNull();}finally{await sql('UPDATE cont_asiento_detalle SET debe=900 WHERE asiento_id=202 AND cuenta_id=2');}});
 it('clasificacion insuficiente bloquea incluso sin movimientos',async()=>{await sql("UPDATE cont_cuentas SET tipo='Otro' WHERE id=7");try{expect((await simularPropuestaRegularizacion(7,9,ejercicios[0])).propuestaSimulada).toBeNull();}finally{await sql("UPDATE cont_cuentas SET tipo='Gasto' WHERE id=7");}});
 it('indicios previos se advierten sin certificar ausencia de regularizacion',async()=>{await asiento(220,'2030-01-03',5,'1.00','0.00');const d=await simularPropuestaRegularizacion(7,9,ejercicios[0]);expect(d.advertenciasPropuesta).toEqual(expect.arrayContaining(['INDICIOS_REGULARIZACION_PREVIA','REGULARIZACIONES_PREVIAS_NO_IDENTIFICABLES']));expect(d.politicaAprobada).toBe(false);});
});
