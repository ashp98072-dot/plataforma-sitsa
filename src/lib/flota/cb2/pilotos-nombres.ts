import { buscarCoincidencias } from "../combustible-coincidencias";
import { nombreEmpleadoComparable } from "./empleados-coincidencias";
export const normalizarNombreReportado=(nombre:string)=>nombre.normalize("NFC").trim().replace(/\s+/gu," ").toLocaleUpperCase("es-GT");
export type DecisionNombre = {tipo:"EMPLEADO";empleadoId:number;confirmado:boolean} | {tipo:"REPORTADO";reportadoId?:number;confirmado:boolean};
export type RevisionNombre = {clave:string;originales:string[];filas:number;candidatos:{id:number;nombre:string}[];propuesta:DecisionNombre|null;equivalencia?:DecisionNombre};
type Empleado={id:number;nombre:string};
function parecidos(a:string,b:string) {
 if(a===b)return true;
 if(Math.min(a.length,b.length)<3 || Math.abs(a.length-b.length)>2)return false;
 let anterior=Array.from({length:b.length+1},(_,i)=>i);
 for(let i=1;i<=a.length;i++){const fila=[i];for(let j=1;j<=b.length;j++)fila[j]=Math.min(fila[j-1]+1,anterior[j]+1,anterior[j-1]+Number(a[i-1]!==b[j-1]));anterior=fila;}
 return anterior[b.length]<=Math.min(2,Math.floor(Math.max(a.length,b.length)/4));
}
/** La similitud solo propone candidatos; nunca acredita identidad. */
export function candidatosNombre(nombre:string,empleados:Empleado[]) {
 const key=nombreEmpleadoComparable(nombre),tokens=key.split(" ").filter(Boolean);
 if(!key)return [];
 const fuzzy=buscarCoincidencias(key,empleados,p=>nombreEmpleadoComparable(p.nombre),"piloto").candidatos;
 const parciales=empleados.filter(p=>{const otras=nombreEmpleadoComparable(p.nombre).split(" ");return tokens.every(t=>otras.some(o=>parecidos(t,o))) || otras.every(t=>tokens.some(o=>parecidos(t,o)));});
 return [...new Map([...parciales,...fuzzy].map(p=>[p.id,p])).values()].sort((a,b)=>a.id-b.id);
}
export function proponerNombre(nombre:string,empleados:Empleado[],equivalencia?:DecisionNombre):RevisionNombre {
 const candidatos=candidatosNombre(nombre,empleados),key=nombreEmpleadoComparable(nombre);
 const exactas=empleados.filter(p=>nombreEmpleadoComparable(p.nombre)===key);
 const aliasValido=equivalencia && exactas.length<2 && (equivalencia.tipo==="EMPLEADO" ? empleados.some(p=>p.id===equivalencia.empleadoId) : exactas.length===0);
 const propuesta=aliasValido ? {...equivalencia,confirmado:false} : candidatos.length===1 && exactas.length===1 ? {tipo:"EMPLEADO" as const,empleadoId:exactas[0].id,confirmado:false} : null;
 return {clave:normalizarNombreReportado(nombre),originales:[nombre],filas:1,candidatos,propuesta,...(equivalencia?{equivalencia}:{})};
}
