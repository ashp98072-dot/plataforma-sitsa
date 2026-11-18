"use client";
import { useState } from "react";
import type { DecisionNombre,RevisionNombre } from "@/lib/flota/cb2/pilotos-nombres";
import { input } from "./controles";
import { decisionesMasivas } from "./nombres-masivos";
export function RevisionNombresCB2({nombres,decisiones,onChange,disabled,instalado,empleados=[]}:{empleados?:{id:number;nombre:string}[];nombres:RevisionNombre[];decisiones:Record<string,DecisionNombre|undefined>;onChange:(clave:string,d:DecisionNombre)=>void;disabled:boolean;instalado:boolean}) {
 const [elegidos,setElegidos]=useState<Record<string,string>>({});
 return <fieldset disabled={disabled} className="space-y-4 rounded-xl border p-4"><legend>Revisar pilotos por nombre distinto</legend><p>Una decisión se aplica a todas las filas de ese nombre. Las equivalencias se guardan únicamente al confirmar la importación.</p>
 {nombres.length>0 && <div role="group" aria-label="Acciones masivas de nombres" className="flex flex-wrap items-center gap-2">
  {(()=>{const m=decisionesMasivas(nombres,decisiones);
  return <><button type="button" disabled={!instalado||m.reportado.length===0} onClick={()=>m.reportado.forEach(n=>onChange(n.clave,{tipo:"REPORTADO",confirmado:true}))}>Guardar como piloto reportado los {m.reportado.length} nombres sin coincidencia</button>
  <button type="button" disabled={!instalado||m.empleado.length===0} onClick={()=>m.empleado.forEach(n=>onChange(n.clave,{tipo:"EMPLEADO",empleadoId:n.candidatos[0].id,confirmado:true}))}>Usar el empleado cuando coinciden todas las palabras del nombre ({m.empleado.length})</button>
  <span role="status">Pendientes de decidir: {m.sinDecidir}{m.manuales>0?` (${m.manuales} con coincidencia aproximada, varios candidatos o equivalencia previa: revísalos uno por uno para no asignar a la persona equivocada)`:""}. Puedes cambiar cualquier decisión después.</span></>;})()}</div>}
 {!instalado && <p role="alert">Registro de equivalencias no instalado. La persistencia de estas decisiones requiere la migración revisada.</p>}
 {nombres.map(n=>{const d=decisiones[n.clave],opciones=[...new Map([...n.candidatos,...empleados].map(p=>[p.id,p])).values()];return <section key={n.clave} className="rounded border p-3"><h3>{n.originales.join(" / ")} — {n.filas} filas</h3>
 <p role="status">{d ? d.tipo==="EMPLEADO"?`Empleado #${d.empleadoId}${d.confirmado?" confirmado":" reconocido"}`:d.reportadoId?`Piloto reportado #${d.reportadoId} reconocido`:"Guardar piloto reportado al importar" : "Requiere confirmación"}</p>
 {n.candidatos.length===0 && <p>Este piloto no está registrado como empleado. ¿Deseas guardarlo como piloto reportado?</p>}{opciones.length>0 ? <><label>Empleado existente (coincidencias primero)<select className={input} value={elegidos[n.clave]??""} onChange={e=>setElegidos(prev=>({...prev,[n.clave]:e.target.value}))}><option value="">Seleccionar coincidencia</option>{opciones.map(p=><option key={p.id} value={p.id}>{p.nombre} · #{p.id}</option>)}</select></label><button type="button" disabled={!elegidos[n.clave] || !instalado} onClick={()=>onChange(n.clave,{tipo:"EMPLEADO",empleadoId:Number(elegidos[n.clave]),confirmado:true})}>Confirmar empleado para todas estas filas</button><p>La similitud no vincula ni fusiona personas. Si ninguno corresponde, confirma expresamente una identidad reportada independiente.</p></> : null}
 {(!n.equivalencia || !n.propuesta) && <button type="button" disabled={!instalado} onClick={()=>onChange(n.clave,{tipo:"REPORTADO",confirmado:true})}>{n.candidatos.length?"Ninguno corresponde; guardar como piloto reportado":"Sí, guardar como piloto reportado"}</button>}
 {n.equivalencia && !n.propuesta && <button type="button" disabled={!instalado} onClick={()=>onChange(n.clave,{...n.equivalencia!,confirmado:true})}>Confirmar equivalencia anterior tras revisar homónimos</button>}
 </section>;})}</fieldset>;
}
