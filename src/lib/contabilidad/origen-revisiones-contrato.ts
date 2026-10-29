import type {PoolConnection,RowDataPacket} from 'mysql2/promise';
import {huellaCondiciones,type MetadatoOrigen} from './regularizacion-control-contrato';

export type RevisionOrigen={asientoId:number;ejercicioId:number;version:number;tipo:string;claseAnterior:string;clase:string;referencia:string;justificacion:string;huellaAnterior:string;huella:string;registradoPor:number;creadoEn:string};
/** La raíz C3C-9 nunca se sustituye. Una cadena incoherente se invalida, no se omite. */
export function resolverRevisiones(original:MetadatoOrigen,revisiones:RevisionOrigen[]){
 let vigente={...original},version=0,invalida=!['NORMAL','REGULARIZACION'].includes(original.clase)||!['REVISION_DOCUMENTADA','EMISION_CONTROLADA'].includes(original.fuente)||!Number.isInteger(original.registradoPor)||original.registradoPor<=0||!original.referencia.trim()||!/^[0-9a-f]{64}$/.test(original.huella);
 for(const r of revisiones){
  if(invalida||r.asientoId!==original.asientoId||r.ejercicioId!==original.ejercicioId||r.version!==version+1||r.huellaAnterior!==huellaCondiciones(vigente)||r.claseAnterior!==vigente.clase||!['NORMAL','REGULARIZACION'].includes(r.clase)||r.justificacion.trim().length<10||r.referencia.trim().length<5||!Number.isInteger(r.registradoPor)||r.registradoPor<=0||!/^[0-9a-f]{64}$/.test(r.huella)||!['REVISION_DOCUMENTAL','RECTIFICACION_DOCUMENTAL'].includes(r.tipo)||(r.tipo==='RECTIFICACION_DOCUMENTAL')!==(r.clase!==vigente.clase)||(r.tipo==='RECTIFICACION_DOCUMENTAL'&&r.registradoPor===vigente.registradoPor)){
   invalida=true;break;
  }
  vigente={asientoId:r.asientoId,ejercicioId:r.ejercicioId,clase:r.clase,fuente:'REVISION_DOCUMENTADA',referencia:r.referencia,huella:r.huella,registradoPor:r.registradoPor};version=r.version;
 }
 return {vigente:invalida?{...vigente,fuente:'CADENA_INVALIDA'}:vigente,version,invalida,huellaVigente:huellaCondiciones(vigente)};
}
export async function revisionesOrigenTx(c:PoolConnection,empresaId:number,entidadId:number,inicio:string,fin:string):Promise<RevisionOrigen[]>{
 const [rows]=await c.query<RowDataPacket[]>(`SELECT r.asiento_id asientoId,r.ejercicio_id ejercicioId,r.version,r.tipo,r.clase_anterior claseAnterior,r.clase,r.referencia,r.justificacion,r.huella_anterior huellaAnterior,r.huella_asiento huella,r.registrado_por registradoPor,DATE_FORMAT(r.creado_en,'%Y-%m-%dT%H:%i:%s') creadoEn
 FROM cont_asientos_origen_revisiones r JOIN cont_asientos a ON a.empresa_id=r.empresa_id AND a.entidad_id=r.entidad_id AND a.id=r.asiento_id
 WHERE r.empresa_id=? AND r.entidad_id=? AND a.fecha>=? AND a.fecha<=? ORDER BY r.asiento_id,r.version`,[empresaId,entidadId,inicio,fin]);
 return rows as RevisionOrigen[];
}
