import { buscarCoincidencias } from "../combustible-coincidencias";
import { crearBuscadorEmpleados, nombreEmpleadoComparable, palabraSignificativa } from "./empleados-coincidencias";
export const normalizarNombreReportado=(nombre:string)=>nombre.normalize("NFC").trim().replace(/\s+/gu," ").toLocaleUpperCase("es-GT");
export type DecisionNombre = {tipo:"EMPLEADO";empleadoId:number;confirmado:boolean;origen?:"EQUIVALENCIA"} | {tipo:"REPORTADO";reportadoId?:number;confirmado:boolean};
export type RevisionNombre = {clave:string;originales:string[];filas:number;rango?:{min:string|null;max:string|null;sinFecha?:boolean};candidatos:{id:number;nombre:string;estado?:string;fechaBaja?:string|null;fechaAlta?:string|null}[];/** IDs que cumplen la política de dos palabras completas (los demás candidatos son solo ayudas visuales aproximadas). */elegibles?:number[];/** La equivalencia histórica apunta a un empleado distinto del que identifica hoy el motor: exige revisión explícita. */conflictoEquivalencia?:{equivalenciaId:number;reconocidoId:number};propuesta:DecisionNombre|null;equivalencia?:DecisionNombre};
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
export function proponerNombre(nombre:string,empleados:Empleado[],equivalencia?:DecisionNombre,rango?:{min:string|null;max:string|null;sinFecha?:boolean},buscar=crearBuscadorEmpleados(empleados), equivalenciaConfirmada = false):RevisionNombre {
 const coincidencia=buscar(nombre);   // misma política que HALEL: ≥2 palabras completas, único, sin ambigüedad; Activo y Baja por igual
 // Los elegibles del motor SIEMPRE son candidatos; los aproximados (erratas, parecidos) se añaden solo como ayuda visual y jamás deciden una asignación.
 const candidatos=[...new Map([...coincidencia.candidatos,...candidatosNombre(nombre,empleados)].map(p=>[p.id,p])).values()].sort((a,b)=>a.id-b.id);
 const reconocido=coincidencia.propuesta?.id??null;
 let propuesta:DecisionNombre|null=reconocido!=null?{tipo:"EMPLEADO",empleadoId:reconocido,confirmado:false}:null,conflicto:RevisionNombre["conflictoEquivalencia"];
 if(equivalencia?.tipo==="EMPLEADO") {
  // Una equivalencia histórica nunca sustituye a una coincidencia inequívoca hacia otro ID ni resuelve una ambigüedad: ante conflicto, revisión explícita.
  if(reconocido!=null && reconocido!==equivalencia.empleadoId){propuesta=null;conflicto={equivalenciaId:equivalencia.empleadoId,reconocidoId:reconocido};}
  const destino = empleados.find(e => e.id === equivalencia.empleadoId && (!e.estado || e.estado === "Activo" || e.estado === "Baja"));
  const homonimos = destino ? empleados.filter(e => (!e.estado || e.estado === "Activo" || e.estado === "Baja") && nombreEmpleadoComparable(e.nombre) === nombreEmpleadoComparable(destino.nombre)) : [];
  if (equivalenciaConfirmada && reconocido === null && coincidencia.candidatos.length === 0 && destino && homonimos.length === 1 && nombreEmpleadoComparable(nombre).split(" ").filter(palabraSignificativa).length >= 2) propuesta = { ...equivalencia, confirmado: false, origen: "EQUIVALENCIA" };
 }
 // Un alias «reportado» no se propone si hoy existe un empleado identificable (se propone el empleado en su lugar).
 else if(equivalencia?.tipo==="REPORTADO" && coincidencia.candidatos.length===0)propuesta={...equivalencia,confirmado:false};
 return {clave:normalizarNombreReportado(nombre),originales:[nombre],filas:1,...(rango?{rango}:{}),candidatos,elegibles:coincidencia.candidatos.map(p=>p.id),...(conflicto?{conflictoEquivalencia:conflicto}:{}),propuesta,...(equivalencia?{equivalencia}:{})};
}
