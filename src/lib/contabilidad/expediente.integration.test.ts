import {consultarExpedientes,registrarEvidencia} from './expediente';
import type {Pool,RowDataPacket} from 'mysql2/promise';
import {randomUUID} from 'node:crypto';
import {beforeAll,afterAll,describe,it,expect,vi} from 'vitest';
const lab=vi.hoisted(()=>({pool:undefined as unknown as Pick<Pool,'getConnection'>}));
vi.mock('@/lib/db',()=>({getPool:()=>{if(!lab.pool)throw Error('BD_OPERATIVA_PROHIBIDA');return lab.pool;}}));
vi.mock('@/lib/load-env',()=>({loadRuntimeEnv:()=>{throw Error('ENV_PROHIBIDO');}}));
import {manifestC3c2,poolC3c2,conectarC3c2} from '../../../scripts/ci/c3c2/connection.mjs';
import {crearEjercicioConPeriodos} from './calendario';
import {consultarPreparacion,guardarPreparacion,registrarOrigenDocumentado} from './regularizacion-control';
import {consultarPoliticasAutorizacion,gestionarPoliticasAutorizacion} from './politicas-autorizacion';
const manifest=process.env.C3C2_MANIFEST;let pool:ReturnType<typeof poolC3c2>;const actor={id:41,username:'lab-operador'};let ejercicio=0,otro=0;
async function sql(text:string,params:(number|string)[]=[]){const c=await conectarC3c2(manifestC3c2(manifest!));try{return (await c.query<RowDataPacket[]>(text,params))[0];}finally{await c.end();}}
async function asiento(n:number,fecha:string,cuenta:number,debe:string,haber:string,estado='Registrado'){
 await sql('INSERT INTO cont_asientos(id,empresa_id,entidad_id,fecha,numero,estado) VALUES (?,7,9,?,?,?)',[n,fecha,'LAB-'+n,estado]);await sql('INSERT INTO cont_asiento_detalle(empresa_id,entidad_id,asiento_id,cuenta_id,debe,haber) VALUES (7,9,?,?,?,?),(7,9,?,6,?,?)',[n,cuenta,debe,haber,n,haber,debe]);
}
const leer=()=>consultarPreparacion(7,9,ejercicio,41);
const entrada=(d:Awaited<ReturnType<typeof leer>>,clave=randomUUID())=>({huellaCondiciones:d.politica.huellaCondiciones,versionEsperada:Number(d.revisiones[0]?.version??0),claveIdempotencia:clave,nota:'Revisión técnica ficticia; política formal pendiente'});
async function documento(asientoId:number,clase:'NORMAL'|'REGULARIZACION',referencia='Documento ficticio '+asientoId){const d=await leer();return {asientoId,clase,referencia,huellaAsiento:d.origenes.find(a=>a.asientoId===asientoId)!.huellaAsiento,confirmacion:'DOCUMENTACION_DE_ORIGEN_REVISADA' as const};}
describe.skipIf(!manifest).sequential('C3C11 MariaDB temporal verificada',()=>{
 beforeAll(async()=>{
  pool=poolC3c2(manifestC3c2(manifest!));lab.pool=pool;
  await sql("INSERT INTO usuario_modulo(usuario_id,empresa_id,modulo,puede_ver,puede_editar) VALUES (41,NULL,'contabilidad',1,1),(42,NULL,'contabilidad',1,0),(43,NULL,'contabilidad',1,1)");
  await sql("UPDATE cont_cuentas SET tipo=CASE id WHEN 1 THEN 'Ingreso' WHEN 2 THEN 'Gasto' ELSE tipo END");
  await sql("INSERT INTO cont_cuentas(id,empresa_id,entidad_id,codigo,nombre,tipo,activa,nivel) VALUES (5,7,9,'RES','Capital ficticio','Capital',1,1),(6,7,9,'CAJA','Caja ficticia','Activo',1,1),(7,7,9,'VACIA','Nominal vacia','Gasto',1,1)");
  for(const year of [2030,2031])await crearEjercicioConPeriodos(7,'lab-operador',{entidadId:9,usuarioId:41,admin:false},{codigo:'LAB'+year,fechaInicio:year+'-01-01',fechaFin:year+'-01-31',periodos:[{codigo:'ENE'+year,fechaInicio:year+'-01-01',fechaFin:year+'-01-31'}]});
  const rows=await sql('SELECT id FROM cont_ejercicios ORDER BY id');ejercicio=Number(rows[0].id);otro=Number(rows[1].id);
  await sql("UPDATE cont_periodos SET estado='CERRADO'");await sql("INSERT INTO cont_control_libro(empresa_id,entidad_id,estado,activado_en) VALUES (7,9,'ACTIVO',CURRENT_TIMESTAMP)");await sql("INSERT INTO cont_cuentas_rol(empresa_id,entidad_id,rol,cuenta_id) VALUES (7,9,'RESULTADO_EJERCICIO',5)");
  await asiento(201,'2030-01-01',1,'0.00','100.00');await asiento(202,'2030-01-31',2,'40.00','0.00');await asiento(203,'2029-12-31',1,'0.00','900.00');await asiento(204,'2031-01-01',1,'0.00','30.00');await asiento(205,'2030-01-02',1,'0.00','999.00','Borrador');
 await sql("UPDATE usuario_modulo SET puede_editar=1 WHERE usuario_id=42");
 await sql("INSERT INTO usuarios VALUES (44,'lab-resolutor','Contabilidad',1,0),(45,'lab-lector','Admin',1,0)");
 await sql("INSERT INTO usuario_empresa VALUES (44,7),(45,7)");
 await sql("INSERT INTO usuario_modulo VALUES (44,NULL,'contabilidad',1,1),(45,NULL,'contabilidad',1,0)");
 for(const n of [201,202])await registrarOrigenDocumentado(7,9,ejercicio,actor,await documento(n,'NORMAL'));
 },120000);
 afterAll(async()=>{await pool?.end();});
 const revisor={id:42,username:'lab-aprobador'};let contador=0;
 const gestion=()=>consultarPoliticasAutorizacion(7,9,ejercicio,41);
 async function politicaInput(codigo='POL-'+(++contador)){
  const d=await gestion();return {operacion:'POLITICA',codigo,versionEsperada:d.politicas.find(p=>p.codigo===codigo)?.version??0,huellaCondiciones:d.preparacion.politica.huellaCondiciones,
   cuentasNominales:d.preparacion.politica.cuentasNominales.map(c=>c.id),cuentaResultadoId:5,tratamientoSignos:'INVERSION_SALDO_EJERCICIO',reglasVigencia:'Solo el ejercicio ficticio seleccionado; requiere revisión formal',justificacion:'Propuesta técnica ficticia para revisar condiciones y responsabilidades',revisorId:42,resolutorId:44,claveIdempotencia:randomUUID(),confirmacion:'PROPUESTA_DE_POLITICA_SIN_APROBACION_FORMAL'};
 }
 async function crearSolicitud(){
  const p=await politicaInput();await gestionarPoliticasAutorizacion(7,9,ejercicio,actor,p);
  await guardarPreparacion(7,9,ejercicio,actor,entrada(await leer()));const d=await gestion();
  const input={operacion:'SOLICITUD',codigo:p.codigo,politicaVersion:1,borradorVersion:d.preparacion.revisiones[0].version,huellaCondiciones:d.preparacion.politica.huellaCondiciones,justificacion:'Solicitud técnica ficticia con política pendiente de validación formal',claveIdempotencia:randomUUID(),confirmacion:'SOLICITUD_TECNICA_NO_CONTABILIZABLE'};
  const r=await gestionarPoliticasAutorizacion(7,9,ejercicio,actor,input);return {id:r.id!,input,politica:p};
 }
 it('expediente reutiliza cadena y exige las tres evidencias',async()=>{const s=await crearSolicitud();const e=(await consultarExpedientes(7,9,ejercicio,41)).expedientes.find(e=>e.solicitud.id===s.id)!;expect(e.completoTecnicamente).toBe(false);expect(e.motivos).toContain('EVIDENCIA_OBLIGATORIA_PENDIENTE:POLITICA');expect(e.aprobadoFormalmente).toBe(false);});
 async function doc(id:string,codigo='POLITICA'){const e=(await consultarExpedientes(7,9,ejercicio,41)).expedientes.find(e=>e.solicitud.id===id)!;return {solicitudId:id,codigo,versionEsperada:e.evidencias.find(v=>v.codigo===codigo)?.version??0,huellaExpediente:e.huellaExpediente,estado:'NO_VERIFICADA',referencia:'Archivo externo ficticio',huellaDocumento:'a'.repeat(64),justificacion:'Referencia declarada, autenticidad no acreditada',claveIdempotencia:randomUUID()};}
 it('idempotencia y auditor?a transaccional',async()=>{const s=await crearSolicitud(),d=await doc(s.id),n=(await sql('SELECT COUNT(*) n FROM auditoria'))[0].n;await registrarEvidencia(7,9,ejercicio,actor,d);expect((await registrarEvidencia(7,9,ejercicio,actor,d)).reutilizado).toBe(true);expect((await sql('SELECT COUNT(*) n FROM auditoria'))[0].n).toBe(Number(n)+1);await expect(registrarEvidencia(7,9,ejercicio,actor,{...d,referencia:'otra'})).rejects.toMatchObject({status:409});});
 it('permisos y aislamiento empresa entidad ejercicio',async()=>{const s=await crearSolicitud(),d=await doc(s.id);for(const id of [43,45])await expect(registrarEvidencia(7,9,ejercicio,{id,username:'lab'},d)).rejects.toMatchObject({status:403});await expect(registrarEvidencia(7,9,otro,actor,d)).rejects.toMatchObject({status:404});await expect(registrarEvidencia(8,9,ejercicio,actor,d)).rejects.toBeDefined();});
 it('concurrencia optimista y ausencia de duplicados',async()=>{const s=await crearSolicitud(),d=await doc(s.id);const r=await Promise.allSettled([registrarEvidencia(7,9,ejercicio,actor,d),registrarEvidencia(7,9,ejercicio,actor,{...d,claveIdempotencia:randomUUID()})]);expect(r.filter(x=>x.status==='fulfilled')).toHaveLength(1);});
 it('revision independiente conserva referencia y huella',async()=>{const s=await crearSolicitud();await registrarEvidencia(7,9,ejercicio,actor,await doc(s.id));const d={...await doc(s.id),estado:'VERIFICADA_TECNICAMENTE'};await expect(registrarEvidencia(7,9,ejercicio,actor,d)).rejects.toMatchObject({status:403});await registrarEvidencia(7,9,ejercicio,revisor,d);const e=(await consultarExpedientes(7,9,ejercicio,41)).expedientes.find(e=>e.solicitud.id===s.id)!;expect(e.evidencias[0].integra).toBe(true);expect(e.motivos.some(m=>m.includes('POLITICA'))).toBe(false);});
 it('completo tecnicamente permanece sin aprobacion formal',async()=>{const s=await crearSolicitud();for(const codigo of ['POLITICA','BORRADOR','REVISION_DOCUMENTAL']){await registrarEvidencia(7,9,ejercicio,actor,await doc(s.id,codigo));await registrarEvidencia(7,9,ejercicio,revisor,{...await doc(s.id,codigo),estado:'VERIFICADA_TECNICAMENTE'});}const e=(await consultarExpedientes(7,9,ejercicio,41)).expedientes.find(e=>e.solicitud.id===s.id)!;expect(e.motivos).toEqual([]);expect(e.completoTecnicamente).toBe(true);expect(e.aprobadoFormalmente).toBe(false);});
 it('fallo de auditoria revierte evidencia',async()=>{const s=await crearSolicitud(),d=await doc(s.id);await sql("CREATE TRIGGER c12_test_audit BEFORE INSERT ON auditoria FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='fallo sintetico'");try{await expect(registrarEvidencia(7,9,ejercicio,actor,d)).rejects.toThrow();expect((await consultarExpedientes(7,9,ejercicio,41)).expedientes.find(e=>e.solicitud.id===s.id)!.evidencias).toEqual([]);}finally{await sql('DROP TRIGGER c12_test_audit');}});
 it('triggers rechazan alteraci?n y borrado hist?rico',async()=>{await expect(sql('UPDATE cont_regularizacion_evidencias SET version=version+1')).rejects.toThrow();await expect(sql('DELETE FROM cont_regularizacion_evidencias')).rejects.toThrow();});
 it('cambios posteriores invalidan cadena documental',async()=>{const s=await crearSolicitud();await registrarEvidencia(7,9,ejercicio,actor,await doc(s.id));await guardarPreparacion(7,9,ejercicio,actor,entrada(await leer()));const e=(await consultarExpedientes(7,9,ejercicio,41)).expedientes.find(e=>e.solicitud.id===s.id)!;expect(e.motivos).toContain('BORRADOR_SUPERADO');expect(e.motivos).toContain('EVIDENCIA_DESACTUALIZADA:POLITICA');expect(e.completoTecnicamente).toBe(false);});
});
