import type {Pool,RowDataPacket} from 'mysql2/promise';
import {beforeAll,afterAll,describe,it,expect,vi} from 'vitest';
const lab=vi.hoisted(()=>({pool:undefined as unknown as Pick<Pool,'getConnection'>}));
vi.mock('@/lib/db',()=>({getPool:()=>{if(!lab.pool)throw Error('BD_OPERATIVA_PROHIBIDA');return lab.pool;}}));
vi.mock('@/lib/load-env',()=>({loadRuntimeEnv:()=>{throw Error('ENV_PROHIBIDO');}}));
import {manifestC3c2,poolC3c2} from '../../../scripts/ci/c3c2/connection.mjs';
import {consultarConfiguracionResultado,guardarCuentaResultado} from './cuenta-resultado';
import {crearEjercicioConPeriodos} from './calendario';import {simularRegularizacion} from './regularizacion';
const manifest=process.env.C3C2_MANIFEST;let pool:ReturnType<typeof poolC3c2>;const actor={id:41,username:'lab-41'};let ejercicio=0;
async function sql(text:string,params:(number|string)[]=[]){const c=await pool.getConnection();try{return (await c.query<RowDataPacket[]>(text,params))[0];}finally{c.release();}}
describe.skipIf(!manifest).sequential('C3C7 MariaDB temporal verificada',()=>{
 beforeAll(async()=>{
  pool=poolC3c2(manifestC3c2(manifest!));lab.pool=pool;
  await sql("UPDATE usuarios SET rol_global='Contabilidad' WHERE id=42");
  await sql("INSERT INTO usuario_modulo(usuario_id,empresa_id,modulo,puede_ver,puede_editar) VALUES (41,NULL,'contabilidad',1,1),(42,NULL,'contabilidad',1,0)");
  await sql("INSERT INTO cont_cuentas(id,empresa_id,entidad_id,codigo,nombre,tipo,activa,nivel) VALUES (5,7,9,'RES-A','Resultado ficticio A','Capital',1,1),(6,7,9,'RES-B','Resultado ficticio B','Capital',1,4),(7,7,9,'RES-OFF','Inactiva','Capital',0,2),(8,7,10,'RES-OTRO','Otro libro','Capital',1,3)");
  await sql("UPDATE cont_cuentas SET tipo='Ingreso' WHERE id=1");
  await crearEjercicioConPeriodos(7,'lab-41',{entidadId:9,usuarioId:41,admin:false},{codigo:'LAB2030',fechaInicio:'2030-01-01',fechaFin:'2030-01-31',periodos:[{codigo:'ENE',fechaInicio:'2030-01-01',fechaFin:'2030-01-31'}]});ejercicio=Number((await sql('SELECT id FROM cont_ejercicios'))[0].id);
 },120000);
 afterAll(async()=>{await pool?.end();});
 it('lector consulta pero no puede modificar ni auditar',async()=>{
  expect((await consultarConfiguracionResultado(7,9,42)).puedeModificar).toBe(false);
  const antes=await sql('SELECT COUNT(*) n FROM auditoria');await expect(guardarCuentaResultado(7,9,{id:42,username:'lab-42'},5,null)).rejects.toMatchObject({status:403});expect(await sql('SELECT COUNT(*) n FROM auditoria')).toEqual(antes);
 });
 it('configura inicialmente con permiso explicito y registra auditoria',async()=>{
  await guardarCuentaResultado(7,9,actor,5,null);const d=await consultarConfiguracionResultado(7,9,41);expect(d.cuenta?.id).toBe(5);expect(d.puedeModificar).toBe(true);
  const audit=(await sql("SELECT detalle FROM auditoria WHERE accion='cuenta_resultado_configurar' ORDER BY id DESC LIMIT 1"))[0];expect(JSON.parse(audit.detalle)).toMatchObject({actorId:41,empresaId:7,entidadId:9,cuentaAnteriorId:null,cuentaNuevaId:5});
 });
 it.each([999,7,1,8])('rechaza cuenta inexistente/inactiva/nominal/ajena %s',async cuenta=>{await expect(guardarCuentaResultado(7,9,actor,cuenta,5)).rejects.toMatchObject({status:422});expect((await consultarConfiguracionResultado(7,9,41)).cuenta?.id).toBe(5);});
 it('empresa ajena no revela configuracion y no permite guardar',async()=>{await expect(consultarConfiguracionResultado(8,9,41)).rejects.toMatchObject({status:404});await expect(guardarCuentaResultado(8,9,actor,5,null)).rejects.toMatchObject({status:403});});
 it('modifica sin inferir aptitud por nivel y audita antes/despues',async()=>{await guardarCuentaResultado(7,9,actor,6,5);expect((await consultarConfiguracionResultado(7,9,41)).cuenta).toMatchObject({id:6,nivel:4});const a=(await sql("SELECT detalle FROM auditoria WHERE accion='cuenta_resultado_configurar' ORDER BY id DESC LIMIT 1"))[0];expect(JSON.parse(a.detalle)).toMatchObject({cuentaAnteriorId:5,cuentaNuevaId:6});});
 it('concurrencia rechaza version anterior y conserva una sola configuracion',async()=>{
  const r=await Promise.allSettled([guardarCuentaResultado(7,9,actor,5,6),guardarCuentaResultado(7,9,actor,5,6)]);expect(r.filter(x=>x.status==='fulfilled')).toHaveLength(1);expect(r.filter(x=>x.status==='rejected')).toHaveLength(1);
  const rows=await sql("SELECT cuenta_id FROM cont_cuentas_rol WHERE empresa_id=7 AND entidad_id=9 AND rol='RESULTADO_EJERCICIO'");expect(rows).toHaveLength(1);expect(rows[0].cuenta_id).toBe(5);
 });
 it('C3C6 muestra cuenta, mantiene politica y propuesta null sin generar asientos ni auditoria',async()=>{
  const antes=await sql('SELECT COUNT(*) n FROM cont_asientos');const audit=await sql('SELECT COUNT(*) n FROM auditoria');const d=await simularRegularizacion(7,9,ejercicio);expect(d.cuentaResultado?.id).toBe(5);expect(d.bloqueantes).not.toContain('CUENTA_RESULTADO_NO_CONFIGURADA');expect(d.bloqueantes).toContain('POLITICA_REGULARIZACION_PENDIENTE');expect(d.estado).toBe('INCOMPLETA');expect(d.propuestaCompleta).toBeNull();expect(await sql('SELECT COUNT(*) n FROM cont_asientos')).toEqual(antes);expect(await sql('SELECT COUNT(*) n FROM auditoria')).toEqual(audit);
 });
 it('revalida una cuenta desactivada despues de configurar',async()=>{await sql('UPDATE cont_cuentas SET activa=0 WHERE id=5');const d=await simularRegularizacion(7,9,ejercicio);expect(d.cuentaResultado).toBeNull();expect(d.bloqueantes).toContain('CUENTA_RESULTADO_INVALIDA');});
 it('dos configuraciones iniciales concurrentes no duplican el rol en otro libro',async()=>{
  const r=await Promise.allSettled([guardarCuentaResultado(7,10,actor,8,null),guardarCuentaResultado(7,10,actor,8,null)]);expect(r.filter(x=>x.status==='fulfilled')).toHaveLength(1);expect(r.filter(x=>x.status==='rejected')).toHaveLength(1);
  expect(await sql("SELECT cuenta_id FROM cont_cuentas_rol WHERE empresa_id=7 AND entidad_id=10 AND rol='RESULTADO_EJERCICIO'")).toHaveLength(1);
 });
});
