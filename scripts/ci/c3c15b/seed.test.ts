import {it,expect,vi} from 'vitest';
import fs from 'node:fs';import path from 'node:path';import {randomUUID} from 'node:crypto';
import type {Pool} from 'mysql2/promise';
const state=vi.hoisted(()=>({pool:undefined as unknown as Pool}));
vi.mock('@/lib/db',()=>({getPool:()=>{if(!state.pool)throw Error('C15B_NO_POOL');return state.pool;}}));
vi.mock('@/lib/load-env',()=>({loadRuntimeEnv:()=>{throw Error('C15B_NO_ENV');}}));
import {verifiedPool} from './database.cjs';
import {crearEjercicioConPeriodos} from '@/lib/contabilidad/calendario';
import {consultarPreparacion,guardarPreparacion,registrarOrigenDocumentado} from '@/lib/contabilidad/regularizacion-control';
import {gestionarPoliticasAutorizacion} from '@/lib/contabilidad/politicas-autorizacion';
import {consultarExpedientes,registrarEvidencia} from '@/lib/contabilidad/expediente';
import {consultarPrecontable,registrarConstancia} from '@/lib/contabilidad/precontable';
import {revisarOrigen} from '@/lib/contabilidad/origen-revisiones';

it('semilla persistente C15B con servicios C9-C13, exclusivamente en marca INITIALIZING',async()=>{
 const file=process.env.C3C15B_SEED;if(!file)throw Error('C15B_EXPLICIT_SEED_REQUIRED');
 const ctx=JSON.parse(fs.readFileSync(file,'utf8'));state.pool=verifiedPool(ctx) as unknown as Pool;
 const sql=async(text:string,params:unknown[]=[])=>{const c=await state.pool.getConnection();try{return (await c.query(text,params))[0];}finally{c.release();}};
 const preparador={id:41,username:'qa-preparador'},revisor={id:42,username:'qa-revisor'},resolutor={id:44,username:'qa-resolutor'};
 try{
  const c=await state.pool.getConnection();try{const [rows]=await c.query('SELECT estado FROM _c3c15_lab');expect((rows as {estado:string}[])[0].estado).toBe('INITIALIZING');}finally{c.release();}
  for(const [id,slug]of [[7,'qa-a'],[8,'qa-b']] as const){await sql('INSERT INTO empresas(id,activa,modulos_json,codigo,nombre,slug) VALUES (?,1,?,?,?,?)',[id,'["contabilidad"]',slug,'Empresa sintetica '+slug,slug]);for(const usuario of [41,42,44,45])await sql('INSERT INTO usuario_empresa VALUES (?,?)',[usuario,id]);}
  const escenarios=[];
  for(const [empresa,entidad,codigo]of [[7,9,'COMPLETO'],[7,10,'PENDIENTE'],[8,11,'DESACTUALIZADO']] as const){
   await sql('INSERT INTO cont_entidades VALUES (?,?,?,?,1)',[entidad,empresa,codigo,'Libro QA '+codigo]);
   const ingreso=entidad*10+1,gasto=ingreso+1,resultado=ingreso+2,caja=ingreso+3;
   for(const [id,cod,tipo]of [[ingreso,'ING','Ingreso'],[gasto,'GAS','Gasto'],[resultado,'RES','Capital'],[caja,'CAJA','Activo']] as const)await sql('INSERT INTO cont_cuentas(id,empresa_id,entidad_id,codigo,activa,nombre,tipo,nivel) VALUES (?,?,?,?,1,?,?,1)',[id,empresa,entidad,cod,'QA '+cod,tipo]);
   await crearEjercicioConPeriodos(empresa,preparador.username,{entidadId:entidad,usuarioId:41,admin:false},{codigo:'QA2035',fechaInicio:'2035-01-01',fechaFin:'2035-01-31',periodos:[{codigo:'ENE',fechaInicio:'2035-01-01',fechaFin:'2035-01-31'}]});
   const rows=await sql('SELECT id FROM cont_ejercicios WHERE empresa_id=? AND entidad_id=?',[empresa,entidad]) as {id:number}[];const ejercicio=Number(rows[0].id);
   await sql("UPDATE cont_periodos SET estado='CERRADO' WHERE empresa_id=? AND entidad_id=?",[empresa,entidad]);
   await sql("INSERT INTO cont_control_libro(empresa_id,entidad_id,estado,activado_en) VALUES (?,?,'ACTIVO',CURRENT_TIMESTAMP)",[empresa,entidad]);
   await sql("INSERT INTO cont_cuentas_rol(empresa_id,entidad_id,rol,cuenta_id) VALUES (?,?,'RESULTADO_EJERCICIO',?)",[empresa,entidad,resultado]);
   for(const [n,fecha,cuenta,debe,haber,estado]of [[1,'2034-12-31',ingreso,'0.00','900.00','Registrado'],[2,'2035-01-10',ingreso,'0.00','100.00','Registrado'],[3,'2035-01-11',gasto,'40.00','0.00','Registrado'],[4,'2035-01-12',ingreso,'0.00','777.00','Borrador'],[5,'2035-02-01',ingreso,'0.00','888.00','Registrado']] as const){
    const id=entidad*100+n;await sql('INSERT INTO cont_asientos(id,empresa_id,entidad_id,fecha,numero,estado) VALUES (?,?,?,?,?,?)',[id,empresa,entidad,fecha,'QA-'+id,estado]);
    await sql('INSERT INTO cont_asiento_detalle(empresa_id,entidad_id,asiento_id,cuenta_id,debe,haber) VALUES (?,?,?,?,?,?),(?,?,?,?,?,?)',[empresa,entidad,id,cuenta,debe,haber,empresa,entidad,id,caja,haber,debe]);
   }
   const leer=()=>consultarPreparacion(empresa,entidad,ejercicio,41);
   for(const o of (await leer()).origenes.filter(o=>o.estado==='Registrado'))await registrarOrigenDocumentado(empresa,entidad,ejercicio,preparador,{asientoId:o.asientoId,clase:'NORMAL',referencia:'QA origen '+o.asientoId,huellaAsiento:o.huellaAsiento,confirmacion:'DOCUMENTACION_DE_ORIGEN_REVISADA'});
   const p=await leer();await gestionarPoliticasAutorizacion(empresa,entidad,ejercicio,preparador,{operacion:'POLITICA',codigo:'QA-POL',versionEsperada:0,huellaCondiciones:p.politica.huellaCondiciones,cuentasNominales:p.politica.cuentasNominales.map(c=>c.id),cuentaResultadoId:resultado,tratamientoSignos:'INVERSION_SALDO_EJERCICIO',reglasVigencia:'Exclusivamente escenario sintetico local de aceptacion',justificacion:'Propuesta tecnica QA sin aprobacion formal',revisorId:42,resolutorId:44,claveIdempotencia:randomUUID(),confirmacion:'PROPUESTA_DE_POLITICA_SIN_APROBACION_FORMAL'});
   await guardarPreparacion(empresa,entidad,ejercicio,preparador,{huellaCondiciones:p.politica.huellaCondiciones,versionEsperada:0,claveIdempotencia:randomUUID(),nota:'Preparacion sintetica QA sin asiento real'});
   const solicitud=await gestionarPoliticasAutorizacion(empresa,entidad,ejercicio,preparador,{operacion:'SOLICITUD',codigo:'QA-POL',politicaVersion:1,borradorVersion:1,huellaCondiciones:p.politica.huellaCondiciones,justificacion:'Solicitud sintetica de aceptacion visual',claveIdempotencia:randomUUID(),confirmacion:'SOLICITUD_TECNICA_NO_CONTABILIZABLE'});
   for(const [version,accion,actor]of [[0,'REVISION_TECNICA',revisor],[1,'DEJAR_PENDIENTE',resolutor]] as const)await gestionarPoliticasAutorizacion(empresa,entidad,ejercicio,actor,{operacion:'DECISION',solicitudId:solicitud.id,versionEsperada:version,accion,justificacion:'Decision tecnica QA sin autorizacion formal',claveIdempotencia:randomUUID(),confirmacion:'DECISION_TECNICA_SIN_APROBACION_CONTABLE'});
   if(codigo!=='PENDIENTE')for(const cod of ['POLITICA','BORRADOR','REVISION_DOCUMENTAL'])for(const [estado,actor]of [['NO_VERIFICADA',preparador],['VERIFICADA_TECNICAMENTE',revisor]] as const){
    const e=(await consultarExpedientes(empresa,entidad,ejercicio,41)).expedientes[0];await registrarEvidencia(empresa,entidad,ejercicio,actor,{solicitudId:solicitud.id,codigo:cod,versionEsperada:e.evidencias.find(v=>v.codigo===cod)?.version??0,huellaExpediente:e.huellaExpediente,estado,referencia:'QA documento '+cod,huellaDocumento:'a'.repeat(64),justificacion:'Documento sintetico, no acredita autenticidad',claveIdempotencia:randomUUID()});
   }
   let d=await consultarPrecontable(empresa,entidad,ejercicio,42),e=d.evaluaciones[0];
   expect(e.informe.originales.saldos.resultadoPreliminar).toBe('60.00');
   if(codigo!=='PENDIENTE'){
    expect(e.informe.completoTecnicamente).toBe(true);await registrarConstancia(empresa,entidad,ejercicio,revisor,{solicitudId:solicitud.id,versionEsperada:0,huellaIntegral:e.informe.huellaIntegral,justificacion:'Constancia sintetica QA para revisar en navegador',claveIdempotencia:randomUUID(),confirmacion:'CONSTANCIA_TECNICA_SIN_APROBACION_FORMAL'});
   }
   if(codigo==='DESACTUALIZADO'){
    const o=(await leer()).origenes.find(o=>o.estado==='Registrado')!;await revisarOrigen(empresa,entidad,ejercicio,revisor,{asientoId:o.asientoId,versionEsperada:0,huellaVigente:o.revisionDocumental!.huellaVigente,huellaAsiento:o.huellaAsiento,tipo:'REVISION_DOCUMENTAL',clase:'NORMAL',justificacion:'Nueva revision sintetica que desactualiza la constancia',referencia:'QA revision posterior',claveIdempotencia:randomUUID(),confirmacion:'DOCUMENTACION_REVISADA_SIN_APROBACION_CONTABLE'});
   }
   d=await consultarPrecontable(empresa,entidad,ejercicio,42);e=d.evaluaciones[0];
   expect(e.informe.estadoFormal).toBe('PENDIENTE');expect(e.informe.contabilizado).toBe(false);
   expect(e.informe.completoTecnicamente).toBe(codigo==='COMPLETO');
   if(codigo==='DESACTUALIZADO')expect(e.historial[0].vigente).toBe(false);
   expect((await consultarPrecontable(empresa,entidad,ejercicio,45)).evaluaciones[0].puedeRegistrar).toBe(false);
   escenarios.push({empresaId:empresa,entidadId:entidad,ejercicioId:ejercicio,solicitudId:solicitud.id,codigo});
  }
  fs.writeFileSync(path.join(path.dirname(file),'scenarios.json'),JSON.stringify(escenarios,null,2));
 }finally{await state.pool.end();}
},120000);
