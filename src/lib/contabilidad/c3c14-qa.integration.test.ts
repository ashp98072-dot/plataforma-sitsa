import type {Pool,RowDataPacket} from 'mysql2/promise';
import {randomUUID,createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {beforeAll,afterAll,describe,it,expect,vi} from 'vitest';
import ExcelJS from 'exceljs';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {manifestC3c2,poolC3c2,conectarC3c2} from '../../../scripts/ci/c3c2/connection.mjs';
const lab=vi.hoisted(()=>({pool:undefined as unknown as Pick<Pool,'getConnection'>,cookie:undefined as string|undefined}));
vi.mock('@/lib/db',()=>({
 getPool:()=>{if(!lab.pool)throw Error('BD_OPERATIVA_PROHIBIDA');return lab.pool;},
 query:async(text:string,params:unknown[])=>{if(!lab.pool)throw Error('BD_OPERATIVA_PROHIBIDA');const c=await lab.pool.getConnection();try{return (await c.query(text,params))[0];}finally{c.release();}},
}));
// Única costura de sesión: almacén de cookies de Next, sin servidor HTTP/RSC.
// Firma JWT, lectura vigente de usuario, guard tenant y servicios SQL son reales.
vi.mock('next/headers',()=>({cookies:async()=>({get:()=>lab.cookie?{value:lab.cookie}:undefined,set:()=>{throw Error('QA_GUARD_NO_DEBE_ESCRIBIR_COOKIE');}})}));
vi.mock('@/lib/load-env',()=>({loadRuntimeEnv:()=>{throw Error('ENV_OPERATIVO_PROHIBIDO');}}));
import {crearEjercicioConPeriodos} from './calendario';
import {diagnosticarCierre} from './cierre-diagnostico';
import {simularRegularizacion} from './regularizacion';
import {simularPropuestaRegularizacion} from './propuesta-regularizacion';
import {consultarPreparacion,guardarPreparacion,registrarOrigenDocumentado} from './regularizacion-control';
import {revisarOrigen} from './origen-revisiones';
import {consultarPoliticasAutorizacion,gestionarPoliticasAutorizacion} from './politicas-autorizacion';
import {consultarExpedientes,registrarEvidencia} from './expediente';
import {consultarPrecontable,registrarConstancia} from './precontable';
import {precontableAExcel} from './precontable-excel';
import {ResultadoPrecontable} from '@/components/contabilidad/precontable';
import {createSessionToken} from '@/lib/session';
import {precontableHttp} from './precontable-http';

const manifest=process.env.C3C2_MANIFEST;
let pool:ReturnType<typeof poolC3c2>,secuencia=200,asientoId=10000;
const preparador={id:41,username:'qa-preparador'},revisor={id:42,username:'qa-revisor'},resolutor={id:44,username:'qa-resolutor'};
type Escenario={empresaId:number;entidadId:number;ejercicioId:number;ingreso:number;gasto:number;resultado:number;caja:number;codigo:string;solicitudId?:string};
const resultados:Record<string,unknown>[]=[];
async function sql(text:string,params:(number|string)[]=[]){
 const c=await conectarC3c2(manifestC3c2(manifest!));
 try{return (await c.query<RowDataPacket[]>(text,params))[0];}finally{await c.end();}
}
const leer=(s:Escenario)=>consultarPreparacion(s.empresaId,s.entidadId,s.ejercicioId,41);
const gestion=(s:Escenario)=>consultarPoliticasAutorizacion(s.empresaId,s.entidadId,s.ejercicioId,41);
const evaluar=(s:Escenario,actorId=42)=>consultarPrecontable(s.empresaId,s.entidadId,s.ejercicioId,actorId);
const ver=async(s:Escenario)=>(await evaluar(s)).evaluaciones.find(e=>e.informe.solicitudId===s.solicitudId)!;
const cents=(v:string)=>{const [entero,decimal='00']=v.replace('-','').split('.');return (BigInt(entero)*BigInt(100)+BigInt(decimal.padEnd(2,'0')))*(v.startsWith('-')?-BigInt(1):BigInt(1));};

/** Fixture exclusivamente: inserciones balanceadas en la instancia verificada, nunca servicios de contabilización. */
async function movimiento(s:Escenario,cuenta:number,debe:string,haber:string,fecha='2035-01-15',estado='Registrado'){
 const id=++asientoId;
 await sql('INSERT INTO cont_asientos(id,empresa_id,entidad_id,fecha,numero,estado) VALUES (?,?,?,?,?,?)',[id,s.empresaId,s.entidadId,fecha,`QA-${id}`,estado]);
 await sql('INSERT INTO cont_asiento_detalle(empresa_id,entidad_id,asiento_id,cuenta_id,debe,haber) VALUES (?,?,?,?,?,?),(?,?,?,?,?,?)',[s.empresaId,s.entidadId,id,cuenta,debe,haber,s.empresaId,s.entidadId,id,s.caja,haber,debe]);
 return id;
}
async function escenario(codigo:string,ingresos='100.00',gastos='40.00',empresaId=7){
 const entidadId=++secuencia,base=entidadId*10;
 const s:Escenario={empresaId,entidadId,ejercicioId:0,ingreso:base+1,gasto:base+2,resultado:base+3,caja:base+4,codigo};
 await sql('INSERT INTO cont_entidades(id,empresa_id,codigo,nombre,activa) VALUES (?,?,?,?,1)',[entidadId,empresaId,codigo,`Libro QA ${codigo}`]);
 for(const [id,codigoCuenta,tipo]of [[s.ingreso,'ING','Ingreso'],[s.gasto,'GAS','Gasto'],[s.resultado,'RES','Capital'],[s.caja,'CAJ','Activo']] as const)await sql('INSERT INTO cont_cuentas(id,empresa_id,entidad_id,codigo,nombre,tipo,nivel,activa) VALUES (?,?,?,?,?,?,1,1)',[id,empresaId,entidadId,codigoCuenta,`Cuenta QA ${codigoCuenta}`,tipo]);
 await crearEjercicioConPeriodos(empresaId,preparador.username,{entidadId,usuarioId:41,admin:false},{codigo:`QA-${codigo}`,fechaInicio:'2035-01-01',fechaFin:'2035-01-31',periodos:[{codigo:'ENE',fechaInicio:'2035-01-01',fechaFin:'2035-01-31'}]});
 s.ejercicioId=Number((await sql('SELECT id FROM cont_ejercicios WHERE empresa_id=? AND entidad_id=?',[empresaId,entidadId]))[0].id);
 // Estado inicial del fixture; no se ejercen acciones de cierre ni apertura.
 await sql("UPDATE cont_periodos SET estado='CERRADO' WHERE empresa_id=? AND entidad_id=?",[empresaId,entidadId]);
 await sql("INSERT INTO cont_control_libro(empresa_id,entidad_id,estado,activado_en) VALUES (?,?,'ACTIVO',CURRENT_TIMESTAMP)",[empresaId,entidadId]);
 await sql("INSERT INTO cont_cuentas_rol(empresa_id,entidad_id,rol,cuenta_id) VALUES (?,?,'RESULTADO_EJERCICIO',?)",[empresaId,entidadId,s.resultado]);
 await movimiento(s,s.ingreso,'0.00','900.00','2034-12-31');
 for(const [cuenta,importe,esIngreso]of [[s.ingreso,ingresos,true],[s.gasto,gastos,false]] as const){
  if(cents(importe)===BigInt(0))continue;
  const positivo=cents(importe)>BigInt(0),monto=importe.replace('-','');
  await movimiento(s,cuenta,positivo===esIngreso?'0.00':monto,positivo===esIngreso?monto:'0.00');
 }
 // No debe entrar en saldos del ejercicio: borrador ni movimiento posterior al corte.
 await movimiento(s,s.ingreso,'0.00','777.00','2035-01-20','Borrador');
 await movimiento(s,s.ingreso,'0.00','888.00','2035-02-01');
 return s;
}
async function documentar(s:Escenario){
 for(const o of (await leer(s)).origenes.filter(o=>o.estado==='Registrado'))await registrarOrigenDocumentado(s.empresaId,s.entidadId,s.ejercicioId,preparador,{asientoId:o.asientoId,clase:'NORMAL',referencia:`QA-RAIZ-${o.asientoId}`,huellaAsiento:o.huellaAsiento,confirmacion:'DOCUMENTACION_DE_ORIGEN_REVISADA'});
}
async function revision(s:Escenario){
 const o=(await leer(s)).origenes.find(o=>o.estado==='Registrado');if(!o)return;
 const d={asientoId:o.asientoId,versionEsperada:o.revisionDocumental!.version,huellaVigente:o.revisionDocumental!.huellaVigente,huellaAsiento:o.huellaAsiento,tipo:'REVISION_DOCUMENTAL',clase:'NORMAL',justificacion:'Revision documental QA sin cambiar el movimiento original',referencia:`QA-REV-${o.asientoId}-${o.revisionDocumental!.version+1}`,claveIdempotencia:randomUUID(),confirmacion:'DOCUMENTACION_REVISADA_SIN_APROBACION_CONTABLE'};
 await revisarOrigen(s.empresaId,s.entidadId,s.ejercicioId,revisor,d);
 expect((await revisarOrigen(s.empresaId,s.entidadId,s.ejercicioId,revisor,d)).reutilizado).toBe(true);
}
async function prepararSolicitud(s:Escenario){
 const d=await gestion(s);
 await gestionarPoliticasAutorizacion(s.empresaId,s.entidadId,s.ejercicioId,preparador,{operacion:'POLITICA',codigo:s.codigo,versionEsperada:0,huellaCondiciones:d.preparacion.politica.huellaCondiciones,cuentasNominales:d.preparacion.politica.cuentasNominales.map(c=>c.id),cuentaResultadoId:s.resultado,tratamientoSignos:'INVERSION_SALDO_EJERCICIO',reglasVigencia:'Solo fixture QA de este libro y ejercicio, formal pendiente',justificacion:'Politica propuesta para recorrido reproducible QA',revisorId:42,resolutorId:44,claveIdempotencia:randomUUID(),confirmacion:'PROPUESTA_DE_POLITICA_SIN_APROBACION_FORMAL'});
 const p=await leer(s);
 await guardarPreparacion(s.empresaId,s.entidadId,s.ejercicioId,preparador,{huellaCondiciones:p.politica.huellaCondiciones,versionEsperada:p.revisiones[0]?.version??0,claveIdempotencia:randomUUID(),nota:'Borrador tecnico QA no contabilizable'});
 const b=await leer(s);
 const r=await gestionarPoliticasAutorizacion(s.empresaId,s.entidadId,s.ejercicioId,preparador,{operacion:'SOLICITUD',codigo:s.codigo,politicaVersion:1,borradorVersion:b.revisiones[0].version,huellaCondiciones:b.politica.huellaCondiciones,justificacion:'Solicitud de revision integral QA sin autorizacion formal',claveIdempotencia:randomUUID(),confirmacion:'SOLICITUD_TECNICA_NO_CONTABILIZABLE'});
 s.solicitudId=r.id!;
}
async function decision(s:Escenario,accion:'REVISION_TECNICA'|'DEJAR_PENDIENTE',actor=revisor){
 const d=(await gestion(s)).solicitudes.find(x=>x.id===s.solicitudId)!;
 return gestionarPoliticasAutorizacion(s.empresaId,s.entidadId,s.ejercicioId,actor,{operacion:'DECISION',solicitudId:s.solicitudId,versionEsperada:d.version,accion,justificacion:'Decision exclusivamente tecnica del recorrido QA',claveIdempotencia:randomUUID(),confirmacion:'DECISION_TECNICA_SIN_APROBACION_CONTABLE'});
}
async function evidencia(s:Escenario,codigo:string,estado='NO_VERIFICADA'){
 const e=(await consultarExpedientes(s.empresaId,s.entidadId,s.ejercicioId,41)).expedientes.find(e=>e.solicitud.id===s.solicitudId)!;
 return {solicitudId:s.solicitudId,codigo,versionEsperada:e.evidencias.find(v=>v.codigo===codigo)?.version??0,huellaExpediente:e.huellaExpediente,estado,referencia:`QA-DOC-${codigo}`,huellaDocumento:createHash('sha256').update(`QA sintetico ${codigo}`).digest('hex'),justificacion:'Referencia sintetica QA, autenticidad no acreditada',claveIdempotencia:randomUUID()};
}
async function completar(s:Escenario){
 for(const codigo of ['POLITICA','BORRADOR','REVISION_DOCUMENTAL']){
  await registrarEvidencia(s.empresaId,s.entidadId,s.ejercicioId,preparador,await evidencia(s,codigo));
  await registrarEvidencia(s.empresaId,s.entidadId,s.ejercicioId,revisor,await evidencia(s,codigo,'VERIFICADA_TECNICAMENTE'));
 }
}
async function constancia(s:Escenario){const e=await ver(s);return {solicitudId:s.solicitudId,versionEsperada:e.version,huellaIntegral:e.informe.huellaIntegral,justificacion:'Constancia QA independiente con autorizacion formal pendiente',claveIdempotencia:randomUUID(),confirmacion:'CONSTANCIA_TECNICA_SIN_APROBACION_FORMAL'};}
async function originales(s:Escenario){return Promise.all(['cont_asientos','cont_asiento_detalle'].map(t=>sql(`SELECT * FROM ${t} WHERE empresa_id=? AND entidad_id=? ORDER BY id`,[s.empresaId,s.entidadId])));}

describe.skipIf(!manifest).sequential('C3C14 recorrido integral sobre MariaDB temporal',()=>{
 beforeAll(async()=>{
  pool=poolC3c2(manifestC3c2(manifest!));lab.pool=pool;
  await sql("INSERT INTO usuarios VALUES (44,'qa-resolutor','Contabilidad',1,0),(45,'qa-lector','Contabilidad',1,0)");
  for(const id of [41,42,44,45]){await sql('INSERT IGNORE INTO usuario_empresa VALUES (?,7),(?,8)',[id,id]);await sql("INSERT INTO usuario_modulo VALUES (?,NULL,'contabilidad',1,?)",[id,id===45?0:1]);}
  await sql('ALTER TABLE empresas ADD COLUMN codigo VARCHAR(40),ADD COLUMN slug VARCHAR(80),ADD COLUMN logo_url VARCHAR(500)');
  await sql("UPDATE empresas SET codigo=CONCAT('QA',id),slug=IF(id=7,'qa-a','qa-b')");
  await sql('ALTER TABLE usuarios ADD COLUMN nombre VARCHAR(100)');
  await sql('ALTER TABLE usuario_modulo ADD COLUMN puede_crear TINYINT DEFAULT 0,ADD COLUMN puede_eliminar TINYINT DEFAULT 0');
  for(const id of [41,44,45])await sql("INSERT INTO usuario_modulo(usuario_id,empresa_id,modulo,puede_ver) VALUES (?,NULL,'contabilidad_calendario_ver',1)",[id]);
  vi.stubEnv('AUTH_SECRET',randomUUID()+randomUUID());
 },120000);
 afterAll(async()=>{
  if(manifest){const m=manifestC3c2(manifest);fs.writeFileSync(path.join(m.runDir,'c3c14-journey.json'),JSON.stringify({contrato:'C3C14-QA-1',escenarios:resultados,alcance:'Datos sinteticos. Sin autorizacion formal ni contabilizacion productiva.'},null,2));}
  await pool?.end();
  vi.unstubAllEnvs();
 });

 it.each([
  ['BENEFICIO','100.00','40.00','60.00','100.00'],
  ['PERDIDA','40.00','100.00','-60.00','100.00'],
  ['CERO','40.00','40.00','0.00','40.00'],
  ['CONTRARIOS','-20.00','-5.00','-15.00','20.00'],
  ['CENTAVOS','0.03','0.02','0.01','0.03'],
  ['SIN_SALDOS','0.00','0.00','0.00','0.00'],
 ])('%s: cadena completa, conciliacion y originales inmutables',async(codigo,ingresos,gastos,resultado,total)=>{
  const s=await escenario(codigo,ingresos,gastos),antes=await originales(s);
  const c5=await diagnosticarCierre(s.empresaId,s.entidadId,s.ejercicioId);
  expect(c5.bloqueantes).toEqual([]);expect(c5.asientos.debe).toBe(c5.asientos.haber);
  await documentar(s);await revision(s);await prepararSolicitud(s);
  await expect(decision(s,'REVISION_TECNICA',preparador)).rejects.toMatchObject({status:403});
  await decision(s,'REVISION_TECNICA');await decision(s,'DEJAR_PENDIENTE',resolutor);await completar(s);
  const c6=await simularRegularizacion(s.empresaId,s.entidadId,s.ejercicioId),c8=await simularPropuestaRegularizacion(s.empresaId,s.entidadId,s.ejercicioId),e=await ver(s);
  expect(c6.calculo.ingresos).toBe(ingresos);expect(c6.calculo.gastos).toBe(gastos);expect(c6.calculo.resultadoPreliminar).toBe(resultado);
  expect(c6.calculo.nominales.find(c=>c.cuentaId===s.ingreso)?.saldoHistoricoAnterior).toBe('-900.00');
  const propuesta=e.informe.simulacion.propuesta!;expect(propuesta).not.toBeNull();
  expect(propuesta.totales).toMatchObject({debe:total,haber:total,cuadra:true});
  expect(propuesta).toEqual(c8.propuestaSimulada);
  expect(propuesta.lineas.reduce((a,l)=>a+cents(l.debe)-cents(l.haber),BigInt(0))).toBe(BigInt(0));
  expect(e.informe.completoTecnicamente).toBe(true);expect(e.informe.estadoFormal).toBe('PENDIENTE');
  for(const c of c6.calculo.nominales){const inversa=propuesta.lineas.find(l=>l.cuentaId===c.cuentaId);expect(cents(c.saldoEjercicio)+cents(inversa?.debe??'0')-cents(inversa?.haber??'0')).toBe(BigInt(0));}
  const d=await constancia(s);await registrarConstancia(s.empresaId,s.entidadId,s.ejercicioId,revisor,d);
  const emitida=(await ver(s)).historial[0];expect(emitida.vigente).toBe(true);expect(emitida.registro?.informe.contabilizado).toBe(false);
  expect((await registrarConstancia(s.empresaId,s.entidadId,s.ejercicioId,revisor,d)).reutilizado).toBe(true);
  expect(await originales(s)).toEqual(antes);
  resultados.push({codigo,empresaId:s.empresaId,entidadId:s.entidadId,ejercicioId:s.ejercicioId,ingresos,gastos,resultado,debeSimulado:propuesta.totales.debe,haberSimulado:propuesta.totales.haber,historiaAnterior:'-900.00',huellaIntegral:e.informe.huellaIntegral,originalesInmutables:true,formal:'PENDIENTE'});
 },120000);

 it('multiempresa y multientidad positivos, ademas de rechazo cruzado',async()=>{
  const a=await escenario('EMP_A','120.00','20.00',7),b=await escenario('EMP_B','80.00','30.00',8);
  for(const s of [a,b]){await documentar(s);await prepararSolicitud(s);}
  expect((await ver(a)).informe.originales.saldos.resultadoPreliminar).toBe('100.00');
  expect((await ver(b)).informe.originales.saldos.resultadoPreliminar).toBe('50.00');
  expect((await evaluar(a)).evaluaciones.every(e=>e.informe.empresaId===7&&e.informe.entidadId===a.entidadId)).toBe(true);
  await expect(consultarPrecontable(7,b.entidadId,b.ejercicioId,42)).rejects.toMatchObject({status:404});
  await expect(consultarPrecontable(7,a.entidadId,b.ejercicioId,42)).rejects.toMatchObject({status:404});
  await expect(registrarConstancia(7,a.entidadId,a.ejercicioId,revisor,await constancia(b))).rejects.toMatchObject({status:404});
 });

 it('fuente nueva invalida sin modificar ninguna fila original anterior',async()=>{
  const s=await escenario('CAMBIO');await documentar(s);await prepararSolicitud(s);await completar(s);
  const d=await constancia(s);await registrarConstancia(s.empresaId,s.entidadId,s.ejercicioId,revisor,d);
  const antes=await originales(s);await movimiento(s,s.ingreso,'0.00','1.00');
  const e=await ver(s);expect(e.historial[0].vigente).toBe(false);expect(e.historial[0].cambios).toContain('movimientos');
  expect(e.informe.hallazgos.some(h=>h.codigo==='CONDICIONES_MODIFICADAS')).toBe(true);
  const despues=await originales(s);for(let n=0;n<antes.length;n++)for(const r of antes[n])expect(despues[n].find(x=>x.id===r.id)).toEqual(r);
  await expect(registrarConstancia(s.empresaId,s.entidadId,s.ejercicioId,revisor,{...d,versionEsperada:1,claveIdempotencia:randomUUID()})).rejects.toMatchObject({status:409});
 });

 it('decision posterior desactualiza evidencias hasta nueva declaracion y revision',async()=>{
  const s=await escenario('DECISION');await documentar(s);await prepararSolicitud(s);await completar(s);
  await registrarConstancia(s.empresaId,s.entidadId,s.ejercicioId,revisor,await constancia(s));
  await decision(s,'REVISION_TECNICA');let e=await ver(s);
  expect(e.historial[0].cambios).toContain('decisiones');expect(e.informe.completoTecnicamente).toBe(false);
  expect(e.informe.hallazgos.some(h=>h.codigo.startsWith('EVIDENCIA_DESACTUALIZADA:'))).toBe(true);
  await completar(s);e=await ver(s);expect(e.informe.completoTecnicamente).toBe(true);expect(e.historial[0].vigente).toBe(false);
 });

 it('evidencia revocada no restaura version anterior y bloquea integridad tecnica',async()=>{
  const s=await escenario('REVOCADA');await documentar(s);await prepararSolicitud(s);await completar(s);
  await registrarEvidencia(s.empresaId,s.entidadId,s.ejercicioId,preparador,await evidencia(s,'POLITICA','REVOCADA'));
  const e=await ver(s);expect(e.informe.completoTecnicamente).toBe(false);expect(e.informe.hallazgos.some(h=>h.codigo==='EVIDENCIA_REVOCADA:POLITICA')).toBe(true);
 });

 it('lector y responsable revocado no registran constancias',async()=>{
  const s=await escenario('PERMISOS');await documentar(s);await prepararSolicitud(s);const d=await constancia(s);
  expect((await evaluar(s,45)).evaluaciones[0].puedeRegistrar).toBe(false);
  for(const id of [41,44,45,43])await expect(registrarConstancia(s.empresaId,s.entidadId,s.ejercicioId,{id,username:'qa'},d)).rejects.toMatchObject({status:403});
  await sql('UPDATE usuario_modulo SET puede_editar=0 WHERE usuario_id=44');
  try{expect((await ver(s)).puedeRegistrar).toBe(false);await expect(registrarConstancia(s.empresaId,s.entidadId,s.ejercicioId,revisor,d)).rejects.toMatchObject({status:403});}
  finally{await sql('UPDATE usuario_modulo SET puede_editar=1 WHERE usuario_id=44');}
 });

 it('exportacion real y render preservan datos, formulas inertes y estado formal',async()=>{
  const s=await escenario('EXPORT');await documentar(s);await revision(s);await prepararSolicitud(s);await completar(s);
  const datos=await evaluar(s),e=datos.evaluaciones[0],antes=await originales(s),m=manifestC3c2(manifest!);
  const buffer=await precontableAExcel(e.informe);fs.writeFileSync(path.join(m.runDir,'c3c14-precontable.xlsx'),buffer);
  const wb=new ExcelJS.Workbook();await wb.xlsx.load(buffer as unknown as Parameters<typeof wb.xlsx.load>[0]);
  expect(wb.worksheets.map(w=>w.name)).toEqual(['Revision precontable','Saldos originales','Propuesta simulada','Diagnostico','Evidencias y decisiones']);
  expect(wb.getWorksheet('Revision precontable')!.getCell('B11').text).toBe('60.00');
  for(const ws of wb.worksheets)ws.eachRow(row=>row.eachCell(cell=>expect(cell.type).not.toBe(ExcelJS.ValueType.Formula)));
  const html=renderToStaticMarkup(createElement(ResultadoPrecontable,{d:datos,url:'/api/qa?entidad='+s.entidadId}));
  fs.writeFileSync(path.join(m.runDir,'c3c14-render.html'),html);
  fs.writeFileSync(path.join(m.runDir,'c3c14-informe.json'),JSON.stringify(e.informe,null,2));
  expect(html).toContain('NO CONTABILIZADA');expect(html).toContain('Datos contables originales');expect(html).not.toMatch(/<button[^>]*>Aprobar/);
  expect(await originales(s)).toEqual(antes);
  resultados.push({codigo:'EXPORT',excelSha256:createHash('sha256').update(buffer).digest('hex'),hojas:wb.worksheets.length,formulas:0,render:'SSR, no navegador autenticado'});
 });

 it('API con JWT real: 401, lector, revisor, idempotencia y exportacion protegida',async()=>{
  const s=await escenario('API');await documentar(s);await prepararSolicitud(s);await completar(s);
  const url=`http://qa.local/api/empresas/qa-a/contabilidad/ejercicios/${s.ejercicioId}/validacion-precontable?entidad=${s.entidadId}`;
  lab.cookie=undefined;expect((await precontableHttp(new Request(url),'qa-a',String(s.ejercicioId))).status).toBe(401);
  lab.cookie='token-falso';expect((await precontableHttp(new Request(url),'qa-a',String(s.ejercicioId))).status).toBe(401);
  lab.cookie=await createSessionToken({id:45,username:'qa-lector',rol:'Contabilidad'});
  const lector=await precontableHttp(new Request(url),'qa-a',String(s.ejercicioId));expect(lector.status).toBe(200);
  expect((await lector.json()).evaluaciones[0].puedeRegistrar).toBe(false);
  const d=await constancia(s),req=()=>new Request(url,{method:'POST',body:JSON.stringify(d)});
  expect((await precontableHttp(req(),'qa-a',String(s.ejercicioId),true)).status).toBe(403);
  lab.cookie=await createSessionToken({id:42,username:'lab-aprobador',rol:'Admin'});
  const ok=await precontableHttp(req(),'qa-a',String(s.ejercicioId),true);expect(ok.status).toBe(200);expect((await ok.json()).aprobacionFormal).toBe(false);
  const retry=await precontableHttp(req(),'qa-a',String(s.ejercicioId),true);expect((await retry.json()).reutilizado).toBe(true);
  const xlsx=await precontableHttp(new Request(url+'&formato=xlsx&solicitud='+s.solicitudId),'qa-a',String(s.ejercicioId));
  expect(xlsx.status).toBe(200);expect(xlsx.headers.get('Cache-Control')).toBe('private, no-store');
  const wb=new ExcelJS.Workbook(),bytes=Buffer.from(await xlsx.arrayBuffer());await wb.xlsx.load(bytes as unknown as Parameters<typeof wb.xlsx.load>[0]);expect(wb.worksheets.length).toBe(5);
  lab.cookie=undefined;
  resultados.push({codigo:'API-JWT',firma:'JWT real con secreto efimero',guard:'tenant y usuario vigentes en MariaDB',costura:'next/headers.cookies simulado',navegador:false,estados:[401,401,200,403,200],idempotencia:true,excelProtegido:true});
 });
});
