"use client";
import {useEffect,useRef,useState} from 'react';
import type {PreparacionRegularizacion} from '@/lib/contabilidad/regularizacion-control';

export function HistorialDocumental({d}:{d:PreparacionRegularizacion}){
 return <section aria-label="Historial documental C3C-10"><h4>Revisión y rectificación documental · C3C-10</h4>
  <p>La identificación original y cada transición se conservan. Una revisión documental mantiene la clasificación; una rectificación la cambia y exige otro editor autorizado. La revisión técnica de borradores es distinta. Ninguna es una aprobación contable formal.</p>
  {d.origenes.filter(a=>a.revisionDocumental).map(a=><details key={a.asientoId}><summary>Asiento {a.numero} · versión documental {a.revisionDocumental!.version}</summary>
   <p>Original (versión 0): {a.revisionDocumental!.original.clase} · {a.revisionDocumental!.original.fuente} · {a.revisionDocumental!.original.referencia} · actor #{a.revisionDocumental!.original.registradoPor} ? {a.revisionDocumental!.original.creadoEn}</p>
   <p className="break-all">Huella original: {a.revisionDocumental!.original.huella}</p>
   <ol>{d.historialOrigen.filter(r=>r.asientoId===a.asientoId).map(r=><li key={r.version}><p>Versión {r.version} · {r.tipo} · {r.claseAnterior} → {r.clase} · actor #{r.registradoPor} · {r.creadoEn}</p><p>{r.justificacion} · Referencia: {r.referencia}</p><p className="break-all">Huella de asiento: {r.huella} · Enlace anterior: {r.huellaAnterior}</p></li>)}</ol>
   {a.revisionDocumental!.cadenaInvalida&&<p role="alert">Cadena inconsistente: no puede revisarse desde este formulario.</p>}
  </details>)}
 </section>;
}
export function RevisionDocumentalForm({d,url,actualizado}:{d:PreparacionRegularizacion;url:string;actualizado:()=>Promise<void>}){
 const [asiento,setAsiento]=useState(''),[tipo,setTipo]=useState(''),[clase,setClase]=useState(''),[referencia,setReferencia]=useState(''),[justificacion,setJustificacion]=useState(''),[confirmado,setConfirmado]=useState(false),[ocupado,setOcupado]=useState(false),[error,setError]=useState('');
 const actual=useRef<AbortController|null>(null),intento=useRef<{payload:string;clave:string}|null>(null);useEffect(()=>()=>actual.current?.abort(),[]);
 const opciones=d.origenes.filter(a=>a.estado==='Registrado'&&a.revisionDocumental&&!a.revisionDocumental.cadenaInvalida),a=opciones.find(a=>String(a.asientoId)===asiento),vigente=a?.revisionDocumental;
 const claseNueva=tipo==='REVISION_DOCUMENTAL'?vigente?.vigente.clase:clase;
 async function enviar(){if(!a||!vigente)return;const ac=new AbortController();actual.current=ac;setOcupado(true);setError('');try{
  const payload=JSON.stringify({asientoId:a.asientoId,versionEsperada:vigente.version,huellaVigente:vigente.huellaVigente,huellaAsiento:a.huellaAsiento,tipo,clase:claseNueva,referencia:referencia.trim(),justificacion:justificacion.trim(),confirmacion:'DOCUMENTACION_REVISADA_SIN_APROBACION_CONTABLE'});
  if(intento.current?.payload!==payload)intento.current={payload,clave:crypto.randomUUID()};
  const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...JSON.parse(payload),claveIdempotencia:intento.current.clave}),signal:ac.signal}),json=await r.json();if(!r.ok)throw Error(json.error??'No se pudo revisar la procedencia.');intento.current=null;if(!ac.signal.aborted)await actualizado();
 }catch(e){if(!ac.signal.aborted)setError(e instanceof Error?e.message:'No se pudo revisar.');}finally{if(!ac.signal.aborted)setOcupado(false);}}
 if(!d.puedeGuardar)return null;
 return <details><summary>Revisar o rectificar identificación existente</summary><p>Requiere evidencia suficiente. No altera asientos ni períodos, aunque estén cerrados. El historial cambia la huella y desactualiza los borradores técnicos previos. No certifica autenticidad documental.</p>
  <label className="block">Asiento identificado <select value={asiento} onChange={e=>{setAsiento(e.target.value);setClase('');setConfirmado(false);}}><option value="">Seleccionar</option>{opciones.map(a=><option key={a.asientoId} value={a.asientoId}>{a.numero} · versión {a.revisionDocumental!.version}</option>)}</select></label>
  {vigente&&<p>Clasificación vigente: {vigente.vigente.clase} · autor #{vigente.vigente.registradoPor}</p>}
  <label className="block">Operación documental <select value={tipo} onChange={e=>{setTipo(e.target.value);setClase('');setConfirmado(false);}}><option value="">Seleccionar</option><option value="REVISION_DOCUMENTAL">Revisar conservando clasificación</option><option value="RECTIFICACION_DOCUMENTAL">Rectificar clasificación (otro editor autorizado)</option></select></label>
  {tipo==='RECTIFICACION_DOCUMENTAL'&&<label className="block">Clasificación propuesta <select value={clase} onChange={e=>setClase(e.target.value)}><option value="">Seleccionar</option>{['NORMAL','REGULARIZACION'].filter(c=>c!==vigente?.vigente.clase).map(c=><option key={c} value={c}>{c}</option>)}</select></label>}
  <label className="block">Referencia documental <input maxLength={120} value={referencia} onChange={e=>setReferencia(e.target.value)}/></label>
  <label className="block">Justificación obligatoria (10–1000 caracteres)<textarea maxLength={1000} value={justificacion} onChange={e=>setJustificacion(e.target.value)} className="block w-full rounded border p-2"/></label>
  <label className="block"><input type="checkbox" checked={confirmado} onChange={e=>setConfirmado(e.target.checked)}/> Revisé la documentación. Esta transición no aprueba formalmente la contabilidad.</label>
  <button type="button" disabled={ocupado||!vigente||!tipo||!claseNueva||referencia.trim().length<5||justificacion.trim().length<10||!confirmado} onClick={enviar}>Guardar revisión documental auditada</button>{error&&<p role="alert">{error}</p>}
 </details>;
}
