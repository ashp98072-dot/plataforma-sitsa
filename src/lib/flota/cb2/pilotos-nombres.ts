import { buscarCoincidencias } from "../combustible-coincidencias";
import { crearBuscadorEmpleados, nombreEmpleadoComparable } from "./empleados-coincidencias";
export const normalizarNombreReportado=(nombre:string)=>nombre.normalize("NFC").trim().replace(/\s+/gu," ").toLocaleUpperCase("es-GT");
export type DecisionNombre = {tipo:"EMPLEADO";empleadoId:number;confirmado:boolean} | {tipo:"REPORTADO";reportadoId?:number;confirmado:boolean};
export type RevisionNombre = {clave:string;originales:string[];filas:number;rango?:{min:string|null;max:string|null;sinFecha?:boolean};candidatos:{id:number;nombre:string;estado?:string;fechaBaja?:string|null;fechaAlta?:string|null}[];propuesta:DecisionNombre|null;equivalencia?:DecisionNombre};
type Empleado={id:number;nombre:string;estado?:string;fechaBaja?:string|null;fechaAlta?:string|null};
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
export function proponerNombre(nombre:string,empleados:Empleado[],equivalencia?:DecisionNombre,rango?:{min:string|null;max:string|null;sinFecha?:boolean},buscar=crearBuscadorEmpleados(empleados)):RevisionNombre {
 const candidatos=candidatosNombre(nombre,empleados),coincidencia=buscar(nombre);   // misma política que HALEL: ≥2 palabras completas, único, sin ambigüedad; Activo y Baja por igual
 // Una equivalencia previa no puede ocultar ni distorsionar el reconocimiento: un alias hacia un empleado solo vale si el nombre no es ambiguo,
 // y un alias «reportado» no se propone si hoy existe un empleado identificable (el empleado existente se propone en su lugar).
 const aliasValido=equivalencia && coincidencia.candidatos.length<2 && (equivalencia.tipo==="EMPLEADO" ? empleados.some(p=>p.id===equivalencia.empleadoId) : coincidencia.candidatos.length===0);
 const propuesta=aliasValido ? {...equivalencia,confirmado:false} : coincidencia.propuesta ? {tipo:"EMPLEADO" as const,empleadoId:coincidencia.propuesta.id,confirmado:false} : null;
 return {clave:normalizarNombreReportado(nombre),originales:[nombre],filas:1,...(rango?{rango}:{}),candidatos,propuesta,...(equivalencia?{equivalencia}:{})};
}
