'use client';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {CAPACIDADES_PERIODOS,type CapacidadPeriodo} from '@/lib/contabilidad/periodos-contrato';
type Entidad={id:number;codigo:string;nombre:string};
type Periodo={id:number;codigo:string;estado:string;version:number;revision_cierre:number;fechaInicio:string;fechaFin:string};
type Solicitud={id:number;tipo:string;estado:string;solicitante_id:number;version:number;motivo:string};
type Estado={control:{estado:string};periodos:Periodo[];capacidades:CapacidadPeriodo[];solicitudes:Solicitud[];
 historial:{id:number;accion:string;motivo:string;creado_en:string}[];cierres:{id:number;periodo_id:number;revision:number;huella:string}[]};
const panel='rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 sm:p-6';
const campo='w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2.5 text-sm text-[var(--text)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:opacity-60';
const boton='inline-flex min-h-10 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--input)] px-4 py-2 text-sm font-medium text-[var(--text)] transition hover:brightness-125 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50';
const primario=boton.replace('border-[var(--border)]','border-transparent').replace('bg-[var(--input)]','bg-[var(--accent)]').replace('text-[var(--text)]','text-white');

export function EtiquetaPeriodo({estado}:{estado:string}){
  const colores=estado==='ABIERTO'?'border-emerald-400/40 bg-emerald-400/10':estado==='CERRADO'?'border-amber-400/40 bg-amber-400/10':'border-[var(--border)] bg-[var(--input)]';
  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold text-[var(--text)] ${colores}`}>{estado}</span>;
}
export function MotivoOperacion({value,disabled,onChange}:{value:string;disabled:boolean;onChange:(value:string)=>void}){
  return <div className="space-y-2">
    <label htmlFor="motivo-periodo" className="block text-sm font-semibold">Motivo de la operación</label>
    <textarea id="motivo-periodo" className={`${campo} min-h-[100px] resize-y placeholder:text-[var(--muted)]`} rows={4} maxLength={1000} value={value} disabled={disabled} onChange={e=>onChange(e.target.value)}
      aria-describedby="motivo-periodo-ayuda" placeholder="Describe por qué realizas esta operación y su contexto contable. Se incluirá en la auditoría."/>
    <p id="motivo-periodo-ayuda" className="flex flex-wrap justify-between gap-2 text-xs text-[var(--muted)]"><span>Obligatorio para operar: de 20 a 1000 caracteres.</span><span>{value.trim().length} / 1000 caracteres</span></p>
  </div>;
}
export function TablaPeriodos({periodos,control,capacidades,busy,onAction}:{periodos:Periodo[];control:string;capacidades:CapacidadPeriodo[];busy:boolean;onAction:(action:Record<string,unknown>)=>void}){
  const can=(cap:CapacidadPeriodo)=>capacidades.includes(cap);
  return <div className="overflow-x-auto rounded-xl border border-[var(--border)]"><table className="w-full min-w-[640px] text-left text-sm">
    <caption className="sr-only">Períodos contables: código, fechas, estado, versión y acciones disponibles</caption>
    <thead className="bg-[var(--input)] text-[var(--muted)]"><tr>{['Código','Fechas','Estado','Versión','Acciones'].map(h=><th key={h} scope="col" className="px-4 py-3 font-medium">{h}</th>)}</tr></thead>
    <tbody>{periodos.map(p=><tr key={p.id} className="border-t border-[var(--border)] align-top">
      <th scope="row" className="px-4 py-4 font-semibold">{p.codigo}</th><td className="whitespace-nowrap px-4 py-4"><time>{p.fechaInicio}</time><span className="block text-xs text-[var(--muted)]">hasta {p.fechaFin}</span></td>
      <td className="px-4 py-4"><EtiquetaPeriodo estado={p.estado}/></td><td className="px-4 py-4 tabular-nums">{p.version}</td>
      <td className="px-4 py-3"><div className="flex flex-wrap gap-2">
        {p.estado==='CONFIGURADO'&&can('abrir')&&<button type="button" className={primario} disabled={busy} onClick={()=>onAction({accion:'abrir',periodoId:p.id,version:p.version})}>Abrir</button>}
        {p.estado==='ABIERTO'&&control==='ACTIVO'&&can('cerrar')&&<button type="button" className={boton+' border-amber-400/40'} disabled={busy} onClick={()=>onAction({accion:'cerrar',periodoId:p.id,version:p.version})}>Cerrar para nuevos registros</button>}
        {p.estado==='CERRADO'&&can('reabrir_solicitar')&&<button type="button" className={boton} disabled={busy} onClick={()=>onAction({accion:'reabrir_solicitar',periodoId:p.id,version:p.version})}>Solicitar reapertura</button>}
        {!(p.estado==='CONFIGURADO'&&can('abrir')||p.estado==='ABIERTO'&&control==='ACTIVO'&&can('cerrar')||p.estado==='CERRADO'&&can('reabrir_solicitar'))&&<span className="py-2 text-xs text-[var(--muted)]">Sin acciones disponibles</span>}
      </div></td></tr>)}{!periodos.length&&<tr><td colSpan={5} className="px-4 py-8 text-center text-[var(--muted)]">No hay períodos configurados para este libro. Créalos desde el calendario contable.</td></tr>}</tbody>
  </table></div>;
}
async function json(url:string,signal?:AbortSignal,body?:unknown){
  const r=await fetch(url,{signal,cache:'no-store',...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});
  const data=await r.json();if(!r.ok)throw Error(data.error??'Operación no confirmada.');return data;
}
export function ControlPeriodos({slug,actorId}:{slug:string;actorId:number}){
  return <SelectorPeriodos key={slug} slug={slug} actorId={actorId}/>;
}
function SelectorPeriodos({slug,actorId}:{slug:string;actorId:number}){
  const [libros,setLibros]=useState<Entidad[]>([]),[libro,setLibro]=useState(''),[error,setError]=useState('');
  const [cargandoLibros,setCargandoLibros]=useState(true);
  useEffect(()=>{const c=new AbortController();json(`/api/empresas/${slug}/contabilidad/ejercicios/opciones`,c.signal).then(d=>{if(!c.signal.aborted)setLibros(d.entidades);}).catch(e=>{if(!c.signal.aborted)setError(e.message);}).finally(()=>{if(!c.signal.aborted)setCargandoLibros(false);});return()=>c.abort();},[slug]);
  return <div className="mx-auto max-w-7xl space-y-6 text-[var(--text)]"><header className="space-y-2"><h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Control de períodos contables</h1>
    <p className="max-w-3xl text-sm leading-relaxed text-[var(--muted)]">El control se activa expresamente por libro. Abrir no activa el control. Cerrar no genera asientos ni saldos.</p></header>
    <div className={panel}><label className="block max-w-xl space-y-2 text-sm font-semibold"><span className="block">Libro contable</span><select className={campo} disabled={cargandoLibros} value={libro} onChange={e=>setLibro(e.target.value)}><option value="">Seleccionar libro</option>{libros.map(l=><option key={l.id} value={l.id}>{l.codigo} — {l.nombre}</option>)}</select></label>
    {cargandoLibros&&<p role="status" className="mt-3 text-sm text-[var(--muted)]">Cargando libros contables…</p>}
    {!libro&&<p className="mt-3 text-sm text-[var(--muted)]">Selecciona un libro para consultar sus períodos y las acciones autorizadas.</p>}</div>
    {error&&<p role="alert" className="rounded-xl border border-red-400/40 bg-red-400/10 p-4 text-sm">{error}</p>}{libro&&<LibroPeriodos key={`${slug}:${libro}`} slug={slug} entidadId={Number(libro)} actorId={actorId}/>}</div>;
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
  return <section className="space-y-6" aria-busy={busy}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      {data&&<p className="flex items-center gap-2 text-sm">Control del libro <EtiquetaPeriodo estado={data.control.estado}/></p>}
      <button type="button" className={boton} disabled={busy} onClick={()=>setRevision(v=>v+1)}>Actualizar estado e historial</button>
    </div>
    {!data&&!error&&<p role="status" className={panel+' text-sm text-[var(--muted)]'}>Cargando control…</p>}
    {busy&&<p role="status" className="text-sm text-[var(--muted)]">Procesando operación. Espera la confirmación antes de continuar.</p>}
    {error&&<p role="alert" className="rounded-xl border border-red-400/40 bg-red-400/10 p-4 text-sm leading-relaxed">{error}</p>}
    {mensaje&&<p role="status" className="rounded-xl border border-emerald-400/40 bg-emerald-400/10 p-4 text-sm">{mensaje}</p>}
    {data&&<>
      <div className={panel}><MotivoOperacion value={motivo} disabled={busy} onChange={setMotivo}/></div>
      <section className={panel} aria-labelledby="periodos-titulo"><h2 id="periodos-titulo" className="mb-4 text-lg font-semibold">Períodos</h2>
        <TablaPeriodos periodos={data.periodos} control={data.control.estado} capacidades={data.capacidades} busy={busy} onAction={action=>void enviar(action)}/>
      </section>
      {data.control.estado==='NO_ACTIVADO'&&<fieldset disabled={busy} className={panel+' space-y-4'}><legend className="px-2 text-lg font-semibold">Activación con dos personas</legend>
        <p className="text-sm text-[var(--muted)]">Revisa el diagnóstico antes de solicitar la activación. La solicitud debe resolverla otra persona autorizada.</p>
        {can('diagnosticar')&&<button type="button" className={boton} onClick={()=>void enviar({accion:'diagnosticar'})}>Ejecutar diagnóstico</button>}
        {diag&&<div className="space-y-4 rounded-xl border border-[var(--border)] bg-[var(--input)] p-4 text-sm"><p><strong>Bloqueantes:</strong> {diag.bloqueantes.join(', ')||'ninguno'}</p><p><strong>Advertencias:</strong> {diag.advertencias.join(', ')||'ninguna'}</p>
          <label className="flex items-start gap-3 leading-relaxed"><input className="mt-1 size-4 shrink-0 accent-[var(--accent)]" type="checkbox" checked={acepta} onChange={e=>setAcepta(e.target.checked)}/>Acepto las advertencias históricas indicadas; no se modificarán registros anteriores.</label>
          {can('activar_solicitar')&&<button type="button" className={primario} disabled={diag.bloqueantes.length>0||diag.advertencias.length>0&&!acepta} onClick={()=>void enviar({accion:'activar_solicitar',diagnosticoId:diag.diagnosticoId,aceptaHistoria:acepta})}>Solicitar activación</button>}</div>}
      </fieldset>}
      <section className={panel} aria-labelledby="solicitudes-titulo"><h2 id="solicitudes-titulo" className="text-lg font-semibold">Solicitudes y aprobaciones</h2>
        <p className="mt-1 mb-4 text-sm text-[var(--muted)]">Solo otra persona con autorización puede aprobar o rechazar una solicitud pendiente.</p>
        <div className="space-y-3">{data.solicitudes.map(s=><article key={s.id} className="space-y-3 rounded-xl border border-[var(--border)] p-4 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">Solicitud #{s.id} · {s.tipo}</h3><EtiquetaPeriodo estado={s.estado}/></div>
          <p className="text-[var(--muted)]">Solicitante #{s.solicitante_id}</p><p className="break-words leading-relaxed">{s.motivo}</p>
          {s.estado==='PENDIENTE'&&s.solicitante_id!==actorId&&can(s.tipo==='ACTIVAR'?'activar_aprobar':'reabrir_aprobar')&&<div className="flex flex-wrap gap-3">
            <button type="button" className={primario} disabled={busy} onClick={()=>void enviar({accion:'resolver',solicitudId:s.id,version:s.version,aprobar:true})}>Aprobar y ejecutar</button>
            <button type="button" className={boton} disabled={busy} onClick={()=>void enviar({accion:'resolver',solicitudId:s.id,version:s.version,aprobar:false})}>Rechazar</button></div>}
        </article>)}{!data.solicitudes.length&&<p className="text-sm text-[var(--muted)]">No hay solicitudes registradas.</p>}</div>
      </section>
      {can('operadores')&&<form onSubmit={operador}><fieldset disabled={busy} className={panel+' space-y-4'}><legend className="px-2 text-lg font-semibold">Operadores autorizados</legend>
        <p className="text-sm text-[var(--muted)]">Habilita capacidades para otra persona en este libro. No se permite la autoasignación.</p>
        <div className="grid items-end gap-4 sm:grid-cols-2 xl:grid-cols-[1fr_2fr_auto_auto]">
          <label className="space-y-2 text-sm font-medium"><span className="block">ID de usuario</span><input className={campo} required type="number" min="1" value={usuario} onChange={e=>setUsuario(e.target.value)} placeholder="ID de la persona"/></label>
          <label className="space-y-2 text-sm font-medium"><span className="block">Capacidad</span><select className={campo} value={cap} onChange={e=>setCap(e.target.value as CapacidadPeriodo)}>{CAPACIDADES_PERIODOS.map(c=><option key={c}>{c}</option>)}</select></label>
          <label className="flex min-h-11 items-center gap-2 text-sm"><input className="size-4 accent-[var(--accent)]" type="checkbox" checked={activo} onChange={e=>setActivo(e.target.checked)}/>Habilitado</label><button type="submit" className={primario}>Guardar operador</button>
        </div>
      </fieldset></form>}
      <section className={panel} aria-labelledby="cierres-titulo"><h2 id="cierres-titulo" className="mb-4 text-lg font-semibold">Evidencias de cierre</h2>
        <div className="space-y-3">{data.cierres.map(c=>{const p=data.periodos.find(p=>p.id===c.periodo_id);return <article key={c.id} className="space-y-2 rounded-xl border border-[var(--border)] p-4 text-sm">
          <a className="font-semibold underline underline-offset-4 focus-visible:outline-2" href={`${url}&cierre=${c.id}`} target="_blank" rel="noreferrer">Cierre #{c.id}, revisión {c.revision}<span className="sr-only"> (abre en otra pestaña)</span></a>
          <p className="text-[var(--muted)]">{p?.estado==='CERRADO'&&p.revision_cierre===c.revision?'Vigente':'Antecedente; no certifica datos vigentes'}</p><p className="break-all font-mono text-xs text-[var(--muted)]">Huella: {c.huella}</p>
        </article>;})}{!data.cierres.length&&<p className="text-sm text-[var(--muted)]">Todavía no hay evidencias de cierre.</p>}</div>
      </section>
      <section className={panel} aria-labelledby="historial-titulo"><h2 id="historial-titulo" className="mb-4 text-lg font-semibold">Historial (últimos 100)</h2>
        <ol className="space-y-3">{data.historial.map(h=><li key={h.id} className="space-y-1 border-l-2 border-[var(--border)] py-1 pl-4 text-sm"><p className="font-semibold">#{h.id} · {h.accion}</p><p className="break-words leading-relaxed">{h.motivo}</p><p className="text-xs text-[var(--muted)]">{String(h.creado_en)}</p></li>)}</ol>
        {!data.historial.length&&<p className="text-sm text-[var(--muted)]">No hay operaciones registradas.</p>}
      </section>
    </>}
  </section>;
}
