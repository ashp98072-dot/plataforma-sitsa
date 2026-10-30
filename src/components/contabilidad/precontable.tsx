"use client";
import {useEffect,useRef,useState} from 'react';
import type {EvaluacionPrecontable} from '@/lib/contabilidad/precontable';
import {AVISO_PRECONTABLE,componentesCambiados} from '@/lib/contabilidad/precontable-contrato';

function exportarJson(valor:unknown,nombre:string){
 const url=URL.createObjectURL(new Blob([JSON.stringify(valor,null,2)],{type:'application/json'}));
 const a=document.createElement('a');a.href=url;a.download=nombre;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
type Enviar=(body:Record<string,unknown>)=>Promise<void>;
export function ResultadoPrecontable({d,url,ocupado=false,enviar,cambios={}}:{d:EvaluacionPrecontable;url:string;ocupado?:boolean;enviar?:Enviar;cambios?:Record<string,string[]>}){
 return <section aria-label="Informe precontable" className="space-y-3">
  <p role="note" className="font-semibold">{d.aviso}</p>
  {!d.evaluaciones.length&&<p>No hay solicitudes C3C-11 para evaluar en este ejercicio y libro.</p>}
  {d.evaluaciones.map(e=>{const i=e.informe;return <details key={i.solicitudId}>
   <summary>Solicitud #{i.solicitudId} · {i.completoTecnicamente?'COMPLETO TÉCNICAMENTE':'CON BLOQUEANTES'} · formal PENDIENTE</summary>
   <p>Empresa #{i.empresaId} · libro #{i.entidadId} · ejercicio {String(i.originales.ejercicio.codigo)} (#{i.ejercicioId}) · {i.evaluadoEn}</p>
   <p>{String(i.identificacion.empresa?.nombre??'')} · {String(i.identificacion.libro?.nombre??'')} · ejercicio {String(i.originales.ejercicio.estado)}</p>
   <ul aria-label="Estado de períodos">{i.originales.periodos.map(p=><li key={p.id}>{p.codigo} · {p.estado}</li>)}</ul>
   <p className="break-all">Huella integral: {i.huellaIntegral}</p>
   {!!cambios[i.solicitudId]?.length&&<p role="status">Cambios desde la consulta anterior: {cambios[i.solicitudId].join(', ')}. El informe anterior está desactualizado.</p>}
   <h4>Datos contables originales · movimientos registrados</h4>
   <p>Debe {i.originales.movimientos.debe} · Haber {i.originales.movimientos.haber}. Ingresos {i.originales.saldos.ingresos} · Gastos {i.originales.saldos.gastos} · Resultado preliminar {i.originales.saldos.resultadoPreliminar}.</p>
   <table><caption>Saldos nominales originales; historia anterior separada</caption><thead><tr><th>Cuenta</th><th>Saldo del ejercicio</th><th>Saldo histórico anterior</th></tr></thead><tbody>{i.originales.saldos.nominales.map(c=><tr key={c.cuentaId}><td>{c.codigo} · {c.nombre}</td><td>{c.saldoEjercicio}</td><td>{c.saldoHistoricoAnterior}</td></tr>)}</tbody></table>
   <h4>Propuesta técnica simulada · NO CONTABILIZADA</h4>
   <p>Cuenta de resultado: {i.originales.cuentaResultado?`${i.originales.cuentaResultado.codigo} · ${i.originales.cuentaResultado.nombre}`:'NO CONFIGURADA'}. Idoneidad formal pendiente.</p>
   {i.simulacion.propuesta?<table><caption>Motor C3C-8 / C3C-9 existente</caption><thead><tr><th>Cuenta</th><th>Debe simulado</th><th>Haber simulado</th></tr></thead><tbody>{i.simulacion.propuesta.lineas.map(c=><tr key={c.cuentaId}><td>{c.codigo} · {c.nombre}</td><td>{c.debe}</td><td>{c.haber}</td></tr>)}</tbody></table>:<p>Propuesta no disponible por bloqueantes del motor existente.</p>}
   <h4>Diagnóstico estructurado</h4><ul>{i.hallazgos.map((h,n)=><li key={n}>{h.nivel}: {h.codigo} · {h.referencias.map(r=>`${r.tipo} #${r.id}${r.version?` v${r.version}`:''}`).join(', ')}</li>)}</ul>
   <h4>Cadena documental y responsables</h4>
   <p>Política {i.expediente.solicitud.codigo} v{i.expediente.solicitud.politicaVersion} · borrador C3C-9 v{i.expediente.solicitud.borradorVersion} · {i.expediente.solicitud.justificacion}</p>
   <p>Responsables: {JSON.stringify(i.expediente.solicitud.politica?.responsables)}</p>
   <ol>{i.expediente.solicitud.historial.map(h=><li key={h.version}>{h.creadoEn} · {h.accion} · actor #{h.creadoPor} · {h.justificacion}</li>)}</ol>
   <ul>{i.expediente.evidencias.map(v=><li key={`${v.codigo}:${v.version}`}>{v.codigo} v{v.version} · {v.estado} · {v.referencia} · {v.justificacion}<p className="break-all">{v.huellaDocumento}</p></li>)}</ul>
   <details><summary>Historial documental C3C-10 y huellas de componentes</summary><pre className="overflow-auto">{JSON.stringify({historial:i.expediente.revisionDocumental,componentes:i.componentes},null,2)}</pre></details>
   <button type="button" onClick={()=>exportarJson({vigencia:'INSTANTANEA_REQUIERE_RECONSULTA',informe:i},`precontable-${i.solicitudId}.json`)}>Exportar informe JSON</button>{' '}
   <a href={`${url}&formato=xlsx&solicitud=${i.solicitudId}`} download>Exportar Excel de evaluación actual</a>
   <h4>Historial de constancias técnicas</h4><p>Una constancia documenta la evaluación, incluidos sus bloqueantes. No aprueba la política ni autoriza contabilizar.</p>
   <ol>{e.historial.map(h=><li key={h.version}>v{h.version} · {h.creadoEn} · actor #{h.creadoPor} · {!h.integra?'INTEGRIDAD INVÁLIDA':h.vigente?'CONDICIONES SIN CAMBIOS':'DESACTUALIZADA'}{h.cambios.length>0&&` · ${h.cambios.join(', ')}`}<p>{h.registro?.justificacion}</p>{h.registro&&<button type="button" onClick={()=>exportarJson({vigenciaActual:h.vigente,cambios:h.cambios,registro:h.registro},`constancia-${i.solicitudId}-v${h.version}.json`)}>Exportar constancia histórica JSON</button>}</li>)}</ol>
   {e.puedeRegistrar&&enviar?<form onSubmit={ev=>{ev.preventDefault();const f=new FormData(ev.currentTarget);void enviar({solicitudId:i.solicitudId,versionEsperada:e.version,huellaIntegral:i.huellaIntegral,justificacion:f.get('justificacion'),confirmacion:'CONSTANCIA_TECNICA_SIN_APROBACION_FORMAL'});}}><fieldset disabled={ocupado}><legend>Constancia del revisor técnico designado</legend><label className="block">Justificación de la evaluación<textarea name="justificacion" required minLength={15} maxLength={1500}/></label><label className="block"><input type="checkbox" required/> Registra una evaluación técnica y conserva los bloqueantes; no concede aprobación formal.</label><button>Registrar constancia técnica</button></fieldset></form>:<p>Registro reservado al revisor designado con responsables y permisos vigentes.</p>}
  </details>;})}
 </section>;
}

export function PrecontablePanel({slug,entidadId,ejercicioId}:{slug:string;entidadId:number;ejercicioId:string}){
 const [d,setD]=useState<EvaluacionPrecontable>(),[error,setError]=useState(''),[ocupado,setOcupado]=useState(false),[mensaje,setMensaje]=useState(''),[cambios,setCambios]=useState<Record<string,string[]>>({});
 const actual=useRef<AbortController|null>(null),previo=useRef<EvaluacionPrecontable|undefined>(undefined),intento=useRef<{payload:string;clave:string}|null>(null);
 useEffect(()=>()=>actual.current?.abort(),[]);
 const url=`/api/empresas/${slug}/contabilidad/ejercicios/${ejercicioId}/validacion-precontable?entidad=${entidadId}`;
 async function cargar(body?:Record<string,unknown>){
  actual.current?.abort();const ac=new AbortController();actual.current=ac;setOcupado(true);setError('');setMensaje('');
  try{
   if(body){const payload=JSON.stringify(body);if(intento.current?.payload!==payload)intento.current={payload,clave:crypto.randomUUID()};const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,claveIdempotencia:intento.current.clave}),signal:ac.signal}),j=await r.json();if(!r.ok)throw Error(j.error??'No se pudo registrar.');intento.current=null;if(!ac.signal.aborted)setMensaje('Constancia técnica registrada. Aprobación formal pendiente.');}
   const r=await fetch(url,{cache:'no-store',signal:ac.signal}),j=await r.json();if(!r.ok)throw Error(j.error??'No se pudo evaluar.');
   if(!ac.signal.aborted){const nuevo=j as EvaluacionPrecontable,next:Record<string,string[]>={};for(const e of nuevo.evaluaciones){const p=previo.current?.evaluaciones.find(p=>p.informe.solicitudId===e.informe.solicitudId);if(p)next[e.informe.solicitudId]=componentesCambiados(p.informe.componentes,e.informe.componentes);}setCambios(next);previo.current=nuevo;setD(nuevo);}
  }catch(e){if(!ac.signal.aborted){setError(e instanceof Error?e.message:'No se pudo evaluar.');setD(undefined);}}
  finally{if(!ac.signal.aborted)setOcupado(false);}
 }
 return <section aria-label="Validación integral C3C-13" className="space-y-3 rounded border p-4"><h3>Validación integral e informe precontable</h3><p>{AVISO_PRECONTABLE}</p><button type="button" disabled={ocupado} onClick={()=>cargar()}>Evaluar / actualizar condiciones</button>{ocupado&&<p role="status">Evaluando la cadena completa…</p>}{error&&<p role="alert">{error}</p>}{mensaje&&<p role="status">{mensaje}</p>}{d&&<ResultadoPrecontable d={d} url={url} ocupado={ocupado} enviar={cargar} cambios={cambios}/>}</section>;
}
