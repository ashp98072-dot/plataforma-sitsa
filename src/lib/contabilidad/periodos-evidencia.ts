import {createHash} from 'node:crypto';
import {ErrorPeriodo} from './periodos-contrato';
export const REGLAS_PERIODOS='C3C2-1';
export const huellaPeriodo=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export type MovimientoPeriodo={asiento:number;fecha:string;estado:string;detalle:number|null;cuenta:number|null;debe:string|null;haber:string|null;ambitoValido:number};
export type PeriodoControl={id:number;ejercicio_id:number;orden:number;codigo:string;fechaInicio:string;fechaFin:string;estado:string;version:number;revision_cierre:number;inicioEjercicio:string;finEjercicio:string};
export function centavosPeriodo(value:string|null){
  if(value===null||!/^\d{1,12}\.\d{2}$/.test(value))throw new ErrorPeriodo('INTEGRIDAD','Importes inválidos en el libro.');
  return BigInt(value.replace('.',''));
}
export function evidenciaMovimientos(rows:MovimientoPeriodo[]){
  const sums=new Map<number,{debe:bigint;haber:bigint;n:number}>();let debe=BigInt(0),haber=BigInt(0);
  for(const r of rows){
    if(!r.detalle||!r.cuenta||Number(r.ambitoValido)!==1||r.estado!=='Registrado')throw new ErrorPeriodo('INTEGRIDAD','Hay asientos incompletos o vínculos incompatibles.');
    const d=centavosPeriodo(r.debe),h=centavosPeriodo(r.haber);
    if(!((d>0&&h===BigInt(0))||(h>0&&d===BigInt(0))))throw new ErrorPeriodo('INTEGRIDAD','Una línea tiene importes incompatibles.');
    const s=sums.get(r.asiento)??{debe:BigInt(0),haber:BigInt(0),n:0};s.debe+=d;s.haber+=h;s.n++;sums.set(r.asiento,s);debe+=d;haber+=h;
  }
  if([...sums.values()].some(s=>s.n<2||s.debe!==s.haber))throw new ErrorPeriodo('DESCUADRE','Hay asientos descuadrados o incompletos.');
  const evidence={reglas:REGLAS_PERIODOS,asientos:sums.size,lineas:rows.length,debeCentavos:String(debe),haberCentavos:String(haber),movimientos:rows};
  if(Buffer.byteLength(JSON.stringify(evidence))>8*1024*1024)throw new ErrorPeriodo('EVIDENCIA_EXCESIVA','El libro supera el límite de evidencia; no se cierra parcialmente.');
  return evidence;
}
export function diagnosticoCalendario(periodos:PeriodoControl[],rows:MovimientoPeriodo[]){
  const bloqueantes:string[]=[];const advertencias:string[]=[];
  try{evidenciaMovimientos(rows);}catch(e){bloqueantes.push(e instanceof ErrorPeriodo?e.codigo:'INTEGRIDAD');}
  if(!periodos.length)bloqueantes.push('CALENDARIO_VACIO');
  const exercises=new Map<number,PeriodoControl[]>();
  for(const p of periodos){
    if(!['CONFIGURADO','ABIERTO','CERRADO'].includes(p.estado)||p.fechaInicio>p.fechaFin||p.fechaInicio<p.inicioEjercicio||p.fechaFin>p.finEjercicio)bloqueantes.push('PERIODO_INVALIDO');
    const group=exercises.get(p.ejercicio_id)??[];group.push(p);exercises.set(p.ejercicio_id,group);
  }
  const ranges=[...exercises.values()].map(group=>group.sort((a,b)=>a.orden-b.orden));
  for(const g of ranges){
    if(g.length>366||g[0].fechaInicio!==g[0].inicioEjercicio||g[g.length-1].fechaFin!==g[0].finEjercicio)bloqueantes.push('COBERTURA');
    g.forEach((p,i)=>{if(p.orden!==i+1||i>0&&Date.parse(p.fechaInicio+'T00:00:00Z')-Date.parse(g[i-1].fechaFin+'T00:00:00Z')!==86400000)bloqueantes.push('CONSECUTIVIDAD');});
  }
  const sorted=[...periodos].sort((a,b)=>a.fechaInicio.localeCompare(b.fechaInicio));
  for(let i=1;i<sorted.length;i++)if(sorted[i].fechaInicio<=sorted[i-1].fechaFin)bloqueantes.push('SOLAPAMIENTO');
  if(rows.some(r=>!periodos.some(p=>p.fechaInicio<=r.fecha&&p.fechaFin>=r.fecha)))advertencias.push('HISTORIA_SIN_COBERTURA');
  if(!periodos.some(p=>p.estado==='ABIERTO'))advertencias.push('SIN_PERIODOS_ABIERTOS');
  return {reglas:REGLAS_PERIODOS,bloqueantes:[...new Set(bloqueantes)],advertencias:[...new Set(advertencias)]};
}
