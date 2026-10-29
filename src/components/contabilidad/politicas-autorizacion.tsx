"use client";
import {useEffect,useRef,useState} from 'react';
import type {GestionPoliticas} from '@/lib/contabilidad/politicas-autorizacion';
import {AVISO_AUTORIZACION,validarTransicion,type DecisionTecnica} from '@/lib/contabilidad/politicas-autorizacion-contrato';

export function ResultadoPoliticas({d}:{d:GestionPoliticas}){
 return <section aria-label="Políticas y solicitudes C3C-11" className="space-y-3 rounded border p-4">
  <h3>Políticas y solicitudes de autorización · {String(d.preparacion.ejercicio.codigo)}</h3>
  <p role="note" className="font-semibold">{d.aviso}</p><p>Empresa #{d.preparacion.empresaId} · Libro #{d.preparacion.entidadId} · Ejercicio #{d.preparacion.ejercicioId} · {d.preparacion.generadoEn}</p>
  <p>Propuesta de política, preparación y revisión técnica son etapas distintas de una autorización formal y de un asiento contabilizado. La aprobación contable efectiva no está habilitada.</p>
  <h4>Decisiones formales pendientes</h4><ul>{d.pendientesFormales.map(p=><li key={p}>{p}</li>)}</ul>
  <h4>Bloqueantes actuales</h4>{d.bloqueantes.length?<ul>{d.bloqueantes.map(b=><li key={b}>{b}</li>)}</ul>:<p>Sin bloqueantes técnicos detectados. Esto no aprueba la política.</p>}
  <h4>Políticas propuestas e historial de versiones</h4>{!d.politicas.length&&<p>No hay políticas propuestas para este ejercicio.</p>}
  {d.politicas.map(p=><details key={`${p.codigo}:${p.version}`}><summary>{p.codigo} · versión {p.version} · PROPUESTA NO APROBADA{p.huellaCondiciones!==d.preparacion.politica.huellaCondiciones?' · condiciones desactualizadas':''}</summary>
   <p>Autor #{p.creadoPor} · {p.creadoEn} · Integridad {p.integra?'verificada técnicamente':'INVÁLIDA'}</p>
   <p>Preparador #{p.responsables.preparadorId} · Revisor técnico #{p.responsables.revisorId} · Resolutor técnico #{p.responsables.resolutorId}</p>
   {p.contrato&&<><p>Vigencia propuesta: {p.contrato.vigencia.inicio} a {p.contrato.vigencia.fin}. Reglas documentadas: {p.contrato.reglasVigencia}</p><p>Justificación: {p.contrato.justificacion}</p>
    <p>Signos: {p.contrato.tratamientoSignos}. Cuenta de resultado: {p.contrato.cuentaResultado?.codigo} · {p.contrato.cuentaResultado?.nombre}. Idoneidad formal pendiente.</p>
    <ul>{p.contrato.cuentasNominales.map(a=><li key={a.id}>{a.codigo} · {a.tipo}</li>)}</ul></>}
   <p className="break-all">Huella de política: {p.huellaPolitica}</p><p className="break-all">Huella de condiciones: {p.huellaCondiciones}</p>
  </details>)}
  <h4>Solicitudes e historial de decisiones</h4>{!d.solicitudes.length&&<p>No hay solicitudes técnicas.</p>}
  {d.solicitudes.map(s=><details key={s.id}><summary>Solicitud #{s.id} · {s.codigo} v{s.politicaVersion} · {s.estadoActual}</summary>
   <p>Borrador C3C-9 v{s.borradorVersion} · preparador #{s.creadoPor} · {s.creadoEn} · {s.justificacion}</p><p>Versión de decisiones: {s.version}. Autorización contable: NO. Asiento contabilizado: NO.</p>
   {s.motivos.length>0&&<ul>{s.motivos.map(m=><li key={m}>{m}</li>)}</ul>}{s.bloqueantes.length>0&&<ul>{s.bloqueantes.map(m=><li key={m}>{m}</li>)}</ul>}
   <ol>{s.historial.map(e=><li key={e.version}>v{e.version} · {e.accion} · anterior {e.estadoAnterior} · actor #{e.creadoPor} · {e.creadoEn} · {e.justificacion}</li>)}</ol>
  </details>)}
 </section>;
}

type Enviar=(body:Record<string,unknown>)=>Promise<void>;
function FormulariosPoliticas({d,enviar,ocupado}:{d:GestionPoliticas;enviar:Enviar;ocupado:boolean}){
 const [codigo,setCodigo]=useState(''),[nominales,setNominales]=useState<number[]>([]),[revisor,setRevisor]=useState(''),[resolutor,setResolutor]=useState(''),[reglas,setReglas]=useState(''),[justificacion,setJustificacion]=useState(''),[confirmado,setConfirmado]=useState(false);
 const [politica,setPolitica]=useState(''),[notaSolicitud,setNotaSolicitud]=useState(''),[solicitud,setSolicitud]=useState(''),[accion,setAccion]=useState(''),[notaDecision,setNotaDecision]=useState('');
 const prep=d.preparacion,actual=d.politicas.find(p=>p.codigo===codigo.trim().toUpperCase()),borrador=prep.revisiones[0];
 const vigentes=d.politicas.filter((p,i,a)=>a.findIndex(x=>x.codigo===p.codigo)===i&&p.integra&&p.huellaCondiciones===prep.politica.huellaCondiciones&&p.responsables.preparadorId===d.usuarioId);
 const seleccion=d.politicas.find(p=>`${p.codigo}:${p.version}`===politica),s=d.solicitudes.find(s=>s.id===solicitud);
 const acciones:DecisionTecnica[]=['REVISION_TECNICA','DEVOLVER','RECHAZAR','DEJAR_PENDIENTE','INVALIDAR'];
 const permitidas=s?.politica?acciones.filter(a=>s.estadoActual!=='INTEGRIDAD_INVALIDA'&&!validarTransicion(s.estado,a,d.usuarioId,s.politica!.responsables,s.obsoleta,s.bloqueantes)):[];
 const etiquetas:Record<DecisionTecnica,string>={REVISION_TECNICA:'Registrar revisión técnica (no aprobación)',DEVOLVER:'Devolver solicitud',RECHAZAR:'Rechazar solicitud',DEJAR_PENDIENTE:'Dejar pendiente de autorización formal',INVALIDAR:'Invalidar solicitud desactualizada'};
 return <fieldset disabled={ocupado} className="space-y-3">
  <details><summary>Proponer o versionar política técnica</summary><p>El responsable de preparación eres tú (#{d.usuarioId}). Selecciona nominales y otros dos responsables con permisos explícitos. No se concede autoridad contable formal. Las reglas se documentan; no ejecutan cálculos personalizados.</p>
   <label className="block">Identificador <input maxLength={40} value={codigo} onChange={e=>setCodigo(e.target.value.toUpperCase())}/></label><p>Versión anterior: {actual?.version??0}. Cuenta de resultado configurada: {prep.politica.cuentaResultado?.codigo??'NO CONFIGURADA'}.</p>
   <p>Tratamiento técnico propuesto: invertir el saldo del ejercicio de cada nominal, sin arrastre histórico (motor C3C-8).</p>
   <fieldset><legend>Nominales contempladas (selección explícita)</legend>{prep.politica.cuentasNominales.filter(a=>a.activa&&['Ingreso','Gasto'].includes(a.tipo)).map(a=><label key={a.id} className="block"><input type="checkbox" checked={nominales.includes(a.id)} onChange={e=>setNominales(v=>e.target.checked?[...v,a.id]:v.filter(id=>id!==a.id))}/>{a.codigo} · {a.tipo}</label>)}</fieldset>
   <label className="block">Revisor técnico <select value={revisor} onChange={e=>setRevisor(e.target.value)}><option value="">Seleccionar</option>{d.elegibles.filter(u=>u.id!==d.usuarioId).map(u=><option key={u.id} value={u.id}>{u.username} (#{u.id})</option>)}</select></label>
   <label className="block">Resolutor técnico <select value={resolutor} onChange={e=>setResolutor(e.target.value)}><option value="">Seleccionar</option>{d.elegibles.filter(u=>u.id!==d.usuarioId&&String(u.id)!==revisor).map(u=><option key={u.id} value={u.id}>{u.username} (#{u.id})</option>)}</select></label>
   <label className="block">Reglas y condiciones de vigencia <textarea maxLength={1000} value={reglas} onChange={e=>setReglas(e.target.value)}/></label>
   <label className="block">Justificación y responsabilidad <textarea maxLength={1000} value={justificacion} onChange={e=>setJustificacion(e.target.value)}/></label>
   <label className="block"><input type="checkbox" checked={confirmado} onChange={e=>setConfirmado(e.target.checked)}/> Propongo estas condiciones para revisión; no son una política formal aprobada.</label>
   <button type="button" disabled={!confirmado||!/^[A-Z0-9][A-Z0-9_-]{1,39}$/.test(codigo.trim())||!nominales.length||!revisor||!resolutor||revisor===resolutor||reglas.trim().length<10||justificacion.trim().length<10||!prep.politica.cuentaResultado} onClick={()=>enviar({operacion:'POLITICA',codigo,versionEsperada:actual?.version??0,huellaCondiciones:prep.politica.huellaCondiciones,cuentasNominales:nominales,cuentaResultadoId:prep.politica.cuentaResultado!.id,tratamientoSignos:'INVERSION_SALDO_EJERCICIO',reglasVigencia:reglas,justificacion,revisorId:Number(revisor),resolutorId:Number(resolutor),confirmacion:'PROPUESTA_DE_POLITICA_SIN_APROBACION_FORMAL'})}>Guardar versión de política propuesta</button>
  </details>
  <details><summary>Preparar solicitud técnica</summary><p>Asocia una política vigente al último borrador C3C-9 preparado por ti. Una solicitud puede conservar bloqueantes para devolución o rechazo; no permite revisión técnica satisfactoria con bloqueantes.</p>
   <label>Política <select value={politica} onChange={e=>setPolitica(e.target.value)}><option value="">Seleccionar</option>{vigentes.map(p=><option key={p.codigo} value={`${p.codigo}:${p.version}`}>{p.codigo} v{p.version}</option>)}</select></label>
   <p>Borrador a vincular: {borrador?`v${borrador.version} · autor #${borrador.creadoPor}`:'No disponible; prepara uno en C3C-9 y actualiza esta consulta.'}</p>
   <label className="block">Justificación de solicitud <textarea maxLength={1000} value={notaSolicitud} onChange={e=>setNotaSolicitud(e.target.value)}/></label>
   <button type="button" disabled={!seleccion||!borrador||borrador.creadoPor!==d.usuarioId||notaSolicitud.trim().length<10} onClick={()=>enviar({operacion:'SOLICITUD',codigo:seleccion!.codigo,politicaVersion:seleccion!.version,borradorVersion:borrador!.version,huellaCondiciones:prep.politica.huellaCondiciones,justificacion:notaSolicitud,confirmacion:'SOLICITUD_TECNICA_NO_CONTABILIZABLE'})}>Preparar solicitud no contabilizable</button>
  </details>
  <details><summary>Revisión y resolución técnica</summary><p>Solo aparecen acciones compatibles con tu responsabilidad. La aprobación contable efectiva permanece deshabilitada.</p>
   <label className="block">Solicitud <select value={solicitud} onChange={e=>{setSolicitud(e.target.value);setAccion('');}}><option value="">Seleccionar</option>{d.solicitudes.map(s=><option key={s.id} value={s.id}>#{s.id} · {s.codigo} · {s.estadoActual}</option>)}</select></label>
   <label className="block">Acción técnica <select value={accion} onChange={e=>setAccion(e.target.value)}><option value="">Seleccionar</option>{permitidas.map(a=><option key={a} value={a}>{etiquetas[a]}</option>)}</select></label>
   <label className="block">Justificación de decisión <textarea maxLength={1000} value={notaDecision} onChange={e=>setNotaDecision(e.target.value)}/></label>
   <button type="button" disabled={!s||!permitidas.includes(accion as DecisionTecnica)||notaDecision.trim().length<10} onClick={()=>enviar({operacion:'DECISION',solicitudId:s!.id,versionEsperada:s!.version,accion,justificacion:notaDecision,confirmacion:'DECISION_TECNICA_SIN_APROBACION_CONTABLE'})}>Registrar decisión técnica auditada</button>
  </details>
 </fieldset>;
}

export function PoliticasAutorizacionPanel({slug,entidadId,ejercicioId}:{slug:string;entidadId:number;ejercicioId:string}){
 const [d,setD]=useState<GestionPoliticas>(),[error,setError]=useState(''),[mensaje,setMensaje]=useState(''),[ocupado,setOcupado]=useState(false);
 const actual=useRef<AbortController|null>(null),intento=useRef<{payload:string;clave:string}|null>(null);useEffect(()=>()=>actual.current?.abort(),[]);
 const url=`/api/empresas/${slug}/contabilidad/ejercicios/${ejercicioId}/politicas-autorizacion?entidad=${entidadId}`;
 async function consultar(body?:Record<string,unknown>){
  actual.current?.abort();const ac=new AbortController();actual.current=ac;setOcupado(true);setError('');setMensaje('');
  try{
   if(body){const payload=JSON.stringify(body);if(intento.current?.payload!==payload)intento.current={payload,clave:crypto.randomUUID()};const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,claveIdempotencia:intento.current.clave}),signal:ac.signal}),json=await r.json();if(!r.ok)throw Error(json.error??'No se pudo guardar.');intento.current=null;if(!ac.signal.aborted)setMensaje('Control técnico registrado con auditoría. No se aprobó ni contabilizó.');}
   const r=await fetch(url,{cache:'no-store',signal:ac.signal}),json=await r.json();if(!r.ok)throw Error(json.error??'No se pudo consultar.');if(!ac.signal.aborted)setD(json);
  }catch(e){if(!ac.signal.aborted)setError(e instanceof Error?e.message:'No se pudo completar.');}finally{if(!ac.signal.aborted)setOcupado(false);}
 }
 return <div className="space-y-3"><p>{AVISO_AUTORIZACION}</p><button type="button" disabled={ocupado} onClick={()=>consultar()}>Consultar políticas y solicitudes</button>{ocupado&&<p role="status">Comprobando condiciones…</p>}{error&&<p role="alert">{error}</p>}{mensaje&&<p role="status">{mensaje}</p>}{d&&<><ResultadoPoliticas d={d}/>{d.puedeGestionar?<FormulariosPoliticas key={d.preparacion.generadoEn} d={d} ocupado={ocupado} enviar={consultar}/>:<p>Acceso de consulta. Sin autorización explícita para gestionar.</p>}</>}</div>;
}
