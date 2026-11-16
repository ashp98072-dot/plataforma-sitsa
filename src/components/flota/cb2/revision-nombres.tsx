"use client";
import { useState } from "react";
import type { DecisionNombre,RevisionNombre } from "@/lib/flota/cb2/pilotos-nombres";
import { input } from "./controles";
export function RevisionNombresCB2({nombres,decisiones,onChange,disabled,instalado,empleados=[]}:{empleados?:{id:number;nombre:string}[];nombres:RevisionNombre[];decisiones:Record<string,DecisionNombre|undefined>;onChange:(clave:string,d:DecisionNombre)=>void;disabled:boolean;instalado:boolean}) {
 const [elegidos,setElegidos]=useState<Record<string,string>>({});
 return <fieldset disabled={disabled} className="space-y-4 rounded-xl border p-4"><legend>Revisar pilotos por nombre distinto</legend><p>Una decisión se aplica a todas las filas de ese nombre. Las equivalencias se guardan únicamente al confirmar la importación.</p>
 {!instalado && <p role="alert">Registro de equivalencias no instalado. La persistencia de estas decisiones requiere la migración revisada.</p>}
 {nombres.map(n=>{const d=decisiones[n.clave],opciones=[...new Map([...n.candidatos,...empleados].map(p=>[p.id,p])).values()];return <section key={n.clave} className="rounded border p-3"><h3>{n.originales.join(" / ")} — {n.filas} filas</h3>
 <p role="status">{d ? d.tipo==="EMPLEADO"?`Empleado #${d.empleadoId}${d.confirmado?" confirmado":" reconocido"}`:d.reportadoId?`Piloto reportado #${d.reportadoId} reconocido`:"Guardar piloto reportado al importar" : "Requiere confirmación"}</p>
 {n.candidatos.length===0 && <p>Este piloto no está registrado como empleado. ¿Deseas guardarlo como piloto reportado?</p>}{opciones.length>0 ? <><label>Empleado existente (coincidencias primero)<select className={input} value={elegidos[n.clave]??""} onChange={e=>setElegidos(prev=>({...prev,[n.clave]:e.target.value}))}><option value="">Seleccionar coincidencia</option>{opciones.map(p=><option key={p.id} value={p.id}>{p.nombre} · #{p.id}</option>)}</select></label><button type="button" disabled={!elegidos[n.clave] || !instalado} onClick={()=>onChange(n.clave,{tipo:"EMPLEADO",empleadoId:Number(elegidos[n.clave]),confirmado:true})}>Confirmar empleado para todas estas filas</button><p>La similitud no vincula ni fusiona personas. Si ninguno corresponde, confirma expresamente una identidad reportada independiente.</p></> : null}
 {(!n.equivalencia || !n.propuesta) && <button type="button" disabled={!instalado} onClick={()=>onChange(n.clave,{tipo:"REPORTADO",confirmado:true})}>{n.candidatos.length?"Ninguno corresponde; guardar como piloto reportado":"Sí, guardar como piloto reportado"}</button>}
 {n.equivalencia && !n.propuesta && <button type="button" disabled={!instalado} onClick={()=>onChange(n.clave,{...n.equivalencia!,confirmado:true})}>Confirmar equivalencia anterior tras revisar homónimos</button>}
 </section>;})}</fieldset>;
}
