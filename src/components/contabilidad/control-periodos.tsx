'use client';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {CAPACIDADES_PERIODOS,type CapacidadPeriodo} from '@/lib/contabilidad/periodos-contrato';
type Entidad={id:number;codigo:string;nombre:string};
type Periodo={id:number;codigo:string;estado:string;version:number;revision_cierre:number;fechaInicio:string;fechaFin:string};
type Solicitud={id:number;tipo:string;estado:string;solicitante_id:number;version:number;motivo:string};
type Estado={control:{estado:string};periodos:Periodo[];capacidades:CapacidadPeriodo[];solicitudes:Solicitud[];
 historial:{id:number;accion:string;motivo:string;creado_en:string}[];cierres:{id:number;periodo_id:number;revision:number;huella:string}[]};
async function json(url:string,signal?:AbortSignal,body?:unknown){
  const r=await fetch(url,{signal,cache:'no-store',...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});
  const data=await r.json();if(!r.ok)throw Error(data.error??'Operación no confirmada.');return data;
}
export function ControlPeriodos({slug,actorId}:{slug:string;actorId:number}){
  const [libros,setLibros]=useState<Entidad[]>([]),[libro,setLibro]=useState(''),[error,setError]=useState('');
  useEffect(()=>{const c=new AbortController();json(`/api/empresas/${slug}/contabilidad/ejercicios/opciones`,c.signal).then(d=>{if(!c.signal.aborted)setLibros(d.entidades);}).catch(e=>{if(!c.signal.aborted)setError(e.message);});return()=>c.abort();},[slug]);
  return <div className="space-y-4"><h1>Control de períodos contables</h1>
    <p>El control se activa expresamente por libro. Abrir no activa el control. Cerrar no genera asientos ni saldos.</p>
    <label>Libro <select value={libro} onChange={e=>setLibro(e.target.value)}><option value="">Seleccionar</option>{libros.map(l=><option key={l.id} value={l.id}>{l.codigo} — {l.nombre}</option>)}</select></label>
    {error&&<p role="alert">{error}</p>}{libro&&<LibroPeriodos key={`${slug}:${libro}`} slug={slug} entidadId={Number(libro)} actorId={actorId}/>}</div>;
}
function LibroPeriodos({slug,entidadId,actorId}:{slug:string;entidadId:number;actorId:number}){
  const url=`/api/empresas/${slug}/contabilidad/periodos-control?entidad=${entidadId}`;
  const [data,setData]=useState<Estado>(),[revision,setRevision]=useState(0),[error,setError]=useState(''),[mensaje,setMensaje]=useState('');
  const [motivo,setMotivo]=useState(''),[busy,setBusy]=useState(false),[diag,setDiag]=useState<{diagnosticoId:number;bloqueantes:string[];advertencias:string[]}>();
  const [acepta,setAcepta]=useState(false),[usuario,setUsuario]=useState(''),[cap,setCap]=useState<CapacidadPeriodo>('abrir'),[activo,setActivo]=useState(true);
  const mounted=useRef(true),locked=useRef(false);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  useEffect(()=>{const c=new AbortController();json(url,c.signal).then(d=>{if(!c.signal.aborted){setData(d);setError('');}}).catch(e=>{if(!c.signal.aborted)setError(e.message);});return()=>c.abort();},[url,revision]);
  async function enviar(action:Record<string,unknown>){
    if(locked.current)return;
    if(motivo.trim().length<20||motivo.trim().length>1000){setError('El motivo debe tener entre 20 y 1000 caracteres.');return;}
    locked.current=true;setBusy(true);setError('');
    try{
      const result=await json(url,undefined,{...action,motivo,operacion:crypto.randomUUID()});
      if(!mounted.current)return;
      if(action.accion==='diagnosticar')setDiag(result);else{setDiag(undefined);setAcepta(false);}
      setMensaje('Operación confirmada.');setRevision(v=>v+1);
    }catch(e){if(mounted.current)setError(`${e instanceof Error?e.message:'Error' } Consulta el historial antes de repetir una operación no confirmada.`);}
    finally{locked.current=false;if(mounted.current)setBusy(false);}
  }
  function operador(e:FormEvent){e.preventDefault();void enviar({accion:'operador',usuarioId:Number(usuario),capacidad:cap,activo});}
  const can=(c:CapacidadPeriodo)=>data?.capacidades.includes(c);
  return <section className="space-y-4">
    {!data&&<p role="status">Cargando control…</p>}{error&&<p role="alert">{error}</p>}{mensaje&&<p role="status">{mensaje}</p>}
    <button disabled={busy} onClick={()=>setRevision(v=>v+1)}>Actualizar estado e historial</button>
    {data&&<><p>Control: {data.control.estado}</p><label>Motivo de la operación <textarea maxLength={1000} value={motivo} disabled={busy} onChange={e=>setMotivo(e.target.value)}/></label>
      <fieldset disabled={busy}><legend>Períodos</legend>{data.periodos.map(p=><div key={p.id} className="border p-2">
        <strong>{p.codigo}</strong> {p.fechaInicio} a {p.fechaFin} · {p.estado} · versión {p.version}
        {p.estado==='CONFIGURADO'&&can('abrir')&&<button onClick={()=>void enviar({accion:'abrir',periodoId:p.id,version:p.version})}>Abrir</button>}
        {p.estado==='ABIERTO'&&data.control.estado==='ACTIVO'&&can('cerrar')&&<button onClick={()=>void enviar({accion:'cerrar',periodoId:p.id,version:p.version})}>Cerrar para nuevos registros</button>}
        {p.estado==='CERRADO'&&can('reabrir_solicitar')&&<button onClick={()=>void enviar({accion:'reabrir_solicitar',periodoId:p.id,version:p.version})}>Solicitar reapertura</button>}
      </div>)}</fieldset>
      {data.control.estado==='NO_ACTIVADO'&&<fieldset disabled={busy}><legend>Activación con dos personas</legend>
        {can('diagnosticar')&&<button onClick={()=>void enviar({accion:'diagnosticar'})}>Ejecutar diagnóstico</button>}
        {diag&&<div><p>Bloqueantes: {diag.bloqueantes.join(', ')||'ninguno'}</p><p>Advertencias: {diag.advertencias.join(', ')||'ninguna'}</p>
          <label><input type="checkbox" checked={acepta} onChange={e=>setAcepta(e.target.checked)}/>Acepto las advertencias históricas indicadas; no se modificarán registros anteriores.</label>
          {can('activar_solicitar')&&<button disabled={diag.bloqueantes.length>0||diag.advertencias.length>0&&!acepta} onClick={()=>void enviar({accion:'activar_solicitar',diagnosticoId:diag.diagnosticoId,aceptaHistoria:acepta})}>Solicitar activación</button>}</div>}
      </fieldset>}
      <h2>Solicitudes</h2>{data.solicitudes.map(s=><div key={s.id}>{s.id} · {s.tipo} · {s.estado} · solicitante #{s.solicitante_id}<p>{s.motivo}</p>
        {s.estado==='PENDIENTE'&&s.solicitante_id!==actorId&&can(s.tipo==='ACTIVAR'?'activar_aprobar':'reabrir_aprobar')&&<>
          <button disabled={busy} onClick={()=>void enviar({accion:'resolver',solicitudId:s.id,version:s.version,aprobar:true})}>Aprobar y ejecutar</button>
          <button disabled={busy} onClick={()=>void enviar({accion:'resolver',solicitudId:s.id,version:s.version,aprobar:false})}>Rechazar</button></>}</div>)}
      {can('operadores')&&<form onSubmit={operador}><fieldset disabled={busy}><legend>Habilitar operador (sin autoasignación)</legend>
        <label>ID usuario <input required type="number" min="1" value={usuario} onChange={e=>setUsuario(e.target.value)}/></label>
        <select value={cap} onChange={e=>setCap(e.target.value as CapacidadPeriodo)}>{CAPACIDADES_PERIODOS.map(c=><option key={c}>{c}</option>)}</select>
        <label><input type="checkbox" checked={activo} onChange={e=>setActivo(e.target.checked)}/>Habilitado</label><button>Guardar operador</button>
      </fieldset></form>}
      <h2>Evidencias de cierre</h2>{data.cierres.map(c=>{const p=data.periodos.find(p=>p.id===c.periodo_id);return <p key={c.id}>
        <a href={`${url}&cierre=${c.id}`} target="_blank" rel="noreferrer">Cierre #{c.id}, revisión {c.revision}</a> · {p?.estado==='CERRADO'&&p.revision_cierre===c.revision?'vigente':'antecedente; no certifica datos vigentes'} · huella {c.huella}</p>;})}
      <h2>Historial (últimos 100)</h2>{data.historial.map(h=><p key={h.id}>{h.id} · {h.accion} · {h.motivo} · {String(h.creado_en)}</p>)}
    </>}
  </section>;
}
