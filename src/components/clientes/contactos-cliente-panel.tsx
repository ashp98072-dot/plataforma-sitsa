"use client";
import { useCallback, useEffect, useMemo, useState } from "react";

type Contacto={id:number;nombre:string;cargo:string|null;telefono:string|null;email:string|null;observaciones:string|null;activo:boolean};
const VACIO={nombre:"",cargo:"",telefono:"",email:"",observaciones:""};
const cls="rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1.5 text-sm";

export function ContactosClientePanel({slug,clienteId,puedeEditar}:{slug:string;clienteId:number;puedeEditar:boolean}){
 const [contactos,setContactos]=useState<Contacto[]>([]),[filtro,setFiltro]=useState<"todos"|"activos"|"inactivos">("todos"),[q,setQ]=useState(""),[form,setForm]=useState(VACIO),[editId,setEditId]=useState<number|null>(null),[abierto,setAbierto]=useState(false),[mensaje,setMensaje]=useState(""),[ocupado,setOcupado]=useState(false);
 const base=`/api/empresas/${slug}/clientes/${clienteId}/contactos`;
 const cargar=useCallback(async()=>{const r=await fetch(base,{cache:"no-store"});const d=await r.json();if(r.ok)setContactos(d.contactos??[]);else setMensaje(d.error??"No se pudieron cargar los contactos.");},[base]);
 useEffect(()=>{
  let vigente=true;
  void fetch(base,{cache:"no-store"}).then(async r=>({r,d:await r.json()})).then(({r,d})=>{
   if(!vigente)return;
   if(r.ok)setContactos(d.contactos??[]);else setMensaje(d.error??"No se pudieron cargar los contactos.");
  });
  return()=>{vigente=false;};
 },[base]);
 const activos=contactos.filter(c=>c.activo).length,inactivos=contactos.length-activos;
 const visibles=useMemo(()=>contactos.filter(c=>(filtro==="todos"||(filtro==="activos"?c.activo:!c.activo))&&`${c.nombre} ${c.cargo??""} ${c.telefono??""} ${c.email??""}`.toLowerCase().includes(q.trim().toLowerCase())),[contactos,filtro,q]);
 function editar(c:Contacto){setEditId(c.id);setForm({nombre:c.nombre,cargo:c.cargo??"",telefono:c.telefono??"",email:c.email??"",observaciones:c.observaciones??""});setAbierto(true);}
 async function guardar(){setOcupado(true);setMensaje("");const url=editId?`${base}/${editId}`:base;const r=await fetch(url,{method:editId?"PATCH":"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(form)});const d=await r.json();if(r.status===409&&d.posibleDuplicado&&confirm(`${d.error} ¿Guardar de todas formas?`)){const rr=await fetch(base,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...form,forzar:true})});const dd=await rr.json();setMensaje(dd.mensaje??dd.error??"");if(rr.ok){setAbierto(false);setForm(VACIO);await cargar();}}else{setMensaje(d.mensaje??d.error??"");if(r.ok){setAbierto(false);setEditId(null);setForm(VACIO);await cargar();}}setOcupado(false);}
 async function cambiar(c:Contacto){const r=await fetch(`${base}/${c.id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({activo:!c.activo})});const d=await r.json();setMensaje(d.mensaje??d.error??"");if(r.ok)await cargar();}
 async function eliminar(c:Contacto){if(!confirm(`Eliminar definitivamente a ${c.nombre}? Solo será posible si nunca se utilizó.`))return;const r=await fetch(`${base}/${c.id}`,{method:"DELETE"});const d=await r.json();setMensaje(d.mensaje??d.error??"");if(r.ok)await cargar();}
 return <section className="space-y-3 border-t border-[var(--border)] pt-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-semibold">CONTACTOS DEL CLIENTE</h3><p className="text-xs text-[var(--muted)]">{activos} activos · {inactivos} inactivos</p></div>{puedeEditar&&!abierto?<button type="button" className="rounded bg-[var(--accent)] px-3 py-1.5 text-sm text-white" onClick={()=>{setEditId(null);setForm(VACIO);setAbierto(true);}}>+ Agregar contacto</button>:null}</div>
 <div className="flex gap-2"><input className={`${cls} min-w-0 flex-1`} placeholder="Buscar contacto..." value={q} onChange={e=>setQ(e.target.value)}/><select className={cls} value={filtro} onChange={e=>setFiltro(e.target.value as typeof filtro)}><option value="todos">Todos</option><option value="activos">Activos</option><option value="inactivos">Inactivos</option></select></div>
 {mensaje?<p className="text-xs text-amber-300">{mensaje}</p>:null}
 {abierto&&puedeEditar?<div className="grid gap-2 rounded border border-[var(--border)] p-3 sm:grid-cols-2 lg:grid-cols-3">{(["nombre","cargo","telefono","email","observaciones"] as const).map(k=><input key={k} className={cls} placeholder={k==="nombre"?"Nombre *":k[0].toUpperCase()+k.slice(1)} value={form[k]} onChange={e=>setForm({...form,[k]:e.target.value})}/>)}<div className="flex gap-2"><button type="button" disabled={ocupado} className="rounded bg-[var(--accent)] px-3 py-1.5 text-white" onClick={()=>void guardar()}>Guardar</button><button type="button" className={cls} onClick={()=>setAbierto(false)}>Cancelar</button></div></div>:null}
 <div className="overflow-x-auto rounded border border-[var(--border)]"><table className="min-w-full text-left text-xs"><thead className="bg-[var(--thead)]"><tr>{["Nombre","Cargo","Teléfono","Email","Estado","Acciones"].map(x=><th key={x} className="p-2">{x}</th>)}</tr></thead><tbody>{visibles.map(c=><tr key={c.id} className={`border-t border-[var(--border)] ${c.activo?"":"opacity-60"}`}><td className="p-2 font-medium">{c.nombre}</td><td className="p-2">{c.cargo||"—"}</td><td className="p-2">{c.telefono||"—"}</td><td className="p-2">{c.email||"—"}</td><td className="p-2">{c.activo?"Activo":"Inactivo"}</td><td className="p-2">{puedeEditar?<div className="flex gap-2"><button type="button" onClick={()=>editar(c)}>Editar</button><button type="button" onClick={()=>void cambiar(c)}>{c.activo?"Desactivar":"Reactivar"}</button>{!c.activo?<button type="button" className="text-red-400" onClick={()=>void eliminar(c)}>Eliminar definitivamente</button>:null}</div>:"—"}</td></tr>)}{!visibles.length?<tr><td colSpan={6} className="p-3 text-center text-[var(--muted)]">Sin contactos.</td></tr>:null}</tbody></table></div></section>;
}
