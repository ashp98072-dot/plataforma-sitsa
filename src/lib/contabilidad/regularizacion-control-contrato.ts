import {createHash} from 'node:crypto';
import {aCentavos} from './reportes/calculo';

/** Serialización estable: el orden de claves no cambia una condición contable. */
export function huellaCondiciones(valor:unknown):string{
 const canonical=(v:unknown):string=>{
  if(v===null||typeof v!=='object')return JSON.stringify(v);
  if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';
  return '{'+Object.entries(v).sort(([a],[b])=>a.localeCompare(b,'en')).map(([k,x])=>JSON.stringify(k)+':'+canonical(x)).join(',')+'}';
 };
 return createHash('sha256').update(canonical(valor)).digest('hex');
}
export type AsientoOrigen={id:number;fecha:string;numero:string;estado:string;glosa:string|null;creadoPor:string|null;lineas:{id:number;cuentaId:number;debe:string;haber:string}[]};
export type MetadatoOrigen={asientoId:number;ejercicioId:number;clase:string;fuente:string;referencia:string;huella:string;registradoPor:number;creadoEn?:string};
export function identificarOrigen(a:AsientoOrigen,metadatos:MetadatoOrigen[],ejercicioId:number,cuentaResultadoId:number|null){
 const rows=metadatos.filter(m=>m.asientoId===a.id),m=rows[0];
 const valido=a.estado==='Registrado'&&rows.length===1&&m.ejercicioId===ejercicioId&&['EMISION_CONTROLADA','REVISION_DOCUMENTADA'].includes(m.fuente)&&m.referencia.trim().length>0&&Number.isInteger(m.registradoPor)&&m.registradoPor>0&&m.huella===huellaCondiciones(a)&&['REGULARIZACION','NORMAL'].includes(m.clase);
 const indicio=a.estado==='Registrado'&&cuentaResultadoId!==null&&a.lineas.some(l=>l.cuentaId===cuentaResultadoId&&(aCentavos(l.debe)!==BigInt(0)||aCentavos(l.haber)!==BigInt(0)));
 return {asientoId:a.id,numero:a.numero,fecha:a.fecha,estado:a.estado,huellaAsiento:huellaCondiciones(a),
  origen:valido?(m.clase==='REGULARIZACION'?'REGULARIZACION_IDENTIFICADA':'NORMAL_IDENTIFICADO'):indicio?'INDICIO':'NO_VERIFICADO',
  evidencia:valido?{fuente:m.fuente,referencia:m.referencia,registradoPor:m.registradoPor}:null,
  metadatoInvalido:rows.length>0&&!valido};
}
export const DECISIONES_PENDIENTES=['POLITICA_REGULARIZACION_PENDIENTE','IDONEIDAD_FORMAL_CUENTA_PENDIENTE','VALIDACION_PROCEDENCIA_HISTORICA_PENDIENTE'] as const;
