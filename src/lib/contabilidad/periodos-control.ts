import type {PoolConnection,RowDataPacket} from 'mysql2/promise';
import {ErrorPeriodo} from './periodos-contrato';

export async function bloquearControl(c:PoolConnection,empresaId:number,entidadId:number){
  // El llamador ya conserva empresa y entidad FOR UPDATE. Nunca activar aquí.
  await c.execute('INSERT IGNORE INTO cont_control_libro (empresa_id,entidad_id) VALUES (?,?)',[empresaId,entidadId]);
  const [rows]=await c.query<RowDataPacket[]>('SELECT * FROM cont_control_libro WHERE empresa_id=? AND entidad_id=? FOR UPDATE',[empresaId,entidadId]);
  if(rows.length!==1)throw new ErrorPeriodo('CONTROL_NO_DISPONIBLE','Configuración del control no disponible.',503);
  return rows[0];
}
export async function comprobarPeriodoAsiento(c:PoolConnection,empresaId:number,entidadId:number,fecha:string){
  const control=await bloquearControl(c,empresaId,entidadId);
  if(!['NO_ACTIVADO','ACTIVO'].includes(control.estado))throw new ErrorPeriodo('CONTROL_INVALIDO','Configuración contable inválida.',503);
  if(control.estado==='ACTIVO'){
    const [rows]=await c.query<RowDataPacket[]>('SELECT id,estado FROM cont_periodos WHERE empresa_id=? AND entidad_id=? AND fecha_inicio<=? AND fecha_fin>=? ORDER BY id FOR UPDATE',[empresaId,entidadId,fecha,fecha]);
    if(rows.length!==1)throw new ErrorPeriodo('PERIODO_AMBIGUO','La fecha debe pertenecer exactamente a un período.');
    if(rows[0].estado!=='ABIERTO')throw new ErrorPeriodo('PERIODO_NO_ABIERTO','El período no está abierto para nuevos asientos.');
  }
  // Mismo commit que el asiento. Invalida diagnósticos incluso con control no activado.
  await c.execute('UPDATE cont_control_libro SET cambios=cambios+1 WHERE empresa_id=? AND entidad_id=?',[empresaId,entidadId]);
}
