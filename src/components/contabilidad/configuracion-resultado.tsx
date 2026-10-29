"use client";
import {useEffect,useState} from 'react';
import type {consultarConfiguracionResultado} from '@/lib/contabilidad/cuenta-resultado';
type Datos=Awaited<ReturnType<typeof consultarConfiguracionResultado>>;
const campo='min-h-11 rounded border border-[var(--border)] bg-[var(--input)] p-2';
export function ConfiguracionResultado({slug}:{slug:string}){
 const [libros,setLibros]=useState<{id:number;codigo:string;nombre:string}[]>([]);const [libro,setLibro]=useState('');const [error,setError]=useState('');
 useEffect(()=>{const c=new AbortController();fetch(`/api/empresas/${slug}/contabilidad/ejercicios/opciones`,{cache:'no-store',signal:c.signal}).then(async r=>{const d=await r.json();if(!r.ok)throw Error(d.error);if(!c.signal.aborted)setLibros(d.entidades);}).catch(e=>{if(!c.signal.aborted)setError(e.message);});return()=>c.abort();},[slug]);
 return <div className="space-y-4 p-4"><h1 className="text-xl font-semibold">Configuración contable: resultado del ejercicio</h1>
  <label>Libro <select className={campo} value={libro} onChange={e=>setLibro(e.target.value)}><option value="">Seleccionar libro</option>{libros.map(l=><option key={l.id} value={l.id}>{l.codigo} — {l.nombre}</option>)}</select></label>
  {error&&<p role="alert">{error}</p>}{libro&&<ResultadoLibro key={`${slug}:${libro}`} slug={slug} libro={libro}/>}</div>;
}
function ResultadoLibro({slug,libro}:{slug:string;libro:string}){
 const [d,setD]=useState<Datos>();const [seleccion,setSeleccion]=useState('');const [buscar,setBuscar]=useState('');const [revision,setRevision]=useState(0);const [error,setError]=useState('');const [mensaje,setMensaje]=useState('');const [ocupado,setOcupado]=useState(false);
 const url=`/api/empresas/${slug}/contabilidad/configuracion/resultado?entidad=${libro}`;
 useEffect(()=>{const c=new AbortController();fetch(url,{cache:'no-store',signal:c.signal}).then(async r=>{const data=await r.json();if(!r.ok)throw Error(data.error);if(!c.signal.aborted){setD(data);setSeleccion(data.cuenta?String(data.cuenta.id):'');}}).catch(e=>{if(!c.signal.aborted)setError(e.message);});return()=>c.abort();},[url,revision]);
 async function guardar(){if(!d)return;setOcupado(true);setError('');setMensaje('');try{const r=await fetch(url,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({cuentaId:Number(seleccion),cuentaAnteriorId:d.cuentaAnteriorId})});const data=await r.json();if(!r.ok)throw Error(data.error);setMensaje('Configuración guardada. La simulación continúa incompleta.');setRevision(v=>v+1);}catch(e){setError(e instanceof Error?e.message:'No se pudo guardar');}finally{setOcupado(false);}}
 return <section className="space-y-3"><button type="button" className={campo} disabled={ocupado} onClick={()=>{setError('');setRevision(v=>v+1);}}>Actualizar configuración</button>{error&&<p role="alert">{error}</p>}{mensaje&&<p role="status">{mensaje}</p>}{!d?<p>Cargando configuración…</p>:<>
  <p role="note">{d.aviso}</p><p>Estado: {d.estado}. Cuenta configurada: {d.cuenta?`${d.cuenta.codigo} — ${d.cuenta.nombre} · nivel ${d.cuenta.nivel}`:'no disponible'}</p>
  {d.puedeModificar?<fieldset disabled={ocupado} className="space-y-3"><label>Buscar cuenta <input className={campo} value={buscar} onChange={e=>setBuscar(e.target.value)}/></label>
   <label>Cuenta activa de Capital <select className={campo} value={seleccion} onChange={e=>setSeleccion(e.target.value)}><option value="">Seleccionar cuenta</option>{d.cuentas.filter(c=>`${c.codigo} ${c.nombre}`.toLocaleLowerCase().includes(buscar.toLocaleLowerCase())).map(c=><option key={c.id} value={c.id}>{c.codigo} — {c.nombre} · nivel {c.nivel}</option>)}</select></label>
   <button type="button" className={campo} disabled={!seleccion||d.estado==='ESQUEMA_NO_DISPONIBLE'} onClick={guardar}>Guardar configuración</button></fieldset>:<p>Acceso de consulta. No tienes permiso de modificación contable.</p>}
 </>}</section>;
}
