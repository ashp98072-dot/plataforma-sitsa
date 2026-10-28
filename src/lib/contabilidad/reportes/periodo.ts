import type {PoolConnection,RowDataPacket} from 'mysql2/promise';
import {AccesoContable} from '../ambito';
export type PeriodoReporte={id:number;ejercicioId:number;ejercicio:string;codigo:string;desde:string;hasta:string;estado:string;version:number;revisionCierre:number};
export function filtroPeriodo(sp:URLSearchParams):{periodoId?:number}{
  if(!sp.has('periodo'))return {};
  const values=sp.getAll('periodo');
  if(values.length!==1||! /^[1-9]\d{0,9}$/.test(values[0])||Number(values[0])>2147483647)throw new AccesoContable('Selecciona un período válido.',400);
  if(sp.has('desde')||sp.has('hasta'))throw new AccesoContable('Selecciona período o fechas manuales, no ambos.',400);
  return {periodoId:Number(values[0])};
}
export async function resolverPeriodoReporte<F extends {periodoId?:number;desde?:string;hasta?:string}>(c:PoolConnection,empresaId:number,entidadId:number,f:F):Promise<{filtros:F;periodoSeleccionado:PeriodoReporte|null}>{
  if(f.periodoId===undefined)return {filtros:f,periodoSeleccionado:null};
  if(!Number.isInteger(f.periodoId)||f.periodoId<1||f.periodoId>2147483647||f.desde!==undefined||f.hasta!==undefined)throw new AccesoContable('Período o combinación de filtros inválida.',400);
  const [rows]=await c.query<RowDataPacket[]>(`SELECT p.id,p.ejercicio_id,e.codigo ejercicio,p.codigo,p.estado,p.version,p.revision_cierre,
    DATE_FORMAT(p.fecha_inicio,'%Y-%m-%d') desde,DATE_FORMAT(p.fecha_fin,'%Y-%m-%d') hasta
    FROM cont_periodos p JOIN cont_ejercicios e ON e.empresa_id=p.empresa_id AND e.entidad_id=p.entidad_id AND e.id=p.ejercicio_id
    WHERE p.empresa_id=? AND p.entidad_id=? AND p.id=?`,[empresaId,entidadId,f.periodoId]);
  if(rows.length!==1)throw new AccesoContable('Período no disponible en este libro.',404);
  const p=rows[0];
  const periodoSeleccionado={id:Number(p.id),ejercicioId:Number(p.ejercicio_id),ejercicio:String(p.ejercicio),codigo:String(p.codigo),desde:String(p.desde),hasta:String(p.hasta),estado:String(p.estado),version:Number(p.version),revisionCierre:Number(p.revision_cierre)};
  return {filtros:{...f,desde:periodoSeleccionado.desde,hasta:periodoSeleccionado.hasta},periodoSeleccionado};
}
