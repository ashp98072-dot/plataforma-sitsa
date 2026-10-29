import type {RowDataPacket} from 'mysql2/promise';
import {getPool} from '@/lib/db';
import {AccesoContable} from './ambito';
import {diagnosticoCalendario,type PeriodoControl} from './periodos-evidencia';
import {aCentavos,deCentavos} from './reportes/calculo';

export type AsientoDiagnostico={id:number;numero:string;fecha:string;estado:string;debe:string;haber:string;lineas:number;invalidas:number};
export function evaluarAsientos(asientos:AsientoDiagnostico[]){
 const registrados=asientos.filter(a=>a.estado==='Registrado');
 const descuadrados=registrados.filter(a=>aCentavos(a.debe)!==aCentavos(a.haber));
 const incompletos=registrados.filter(a=>Number(a.lineas)<2||Number(a.invalidas)>0);
 const debe=registrados.reduce((s,a)=>s+aCentavos(a.debe),BigInt(0));
 const haber=registrados.reduce((s,a)=>s+aCentavos(a.haber),BigInt(0));
 const muestra=(rows:AsientoDiagnostico[])=>rows.slice(0,100).map(a=>({id:Number(a.id),numero:a.numero,fecha:a.fecha,debe:a.debe,haber:a.haber}));
 return {registrados:registrados.length,noRegistrados:asientos.length-registrados.length,
  debe:deCentavos(debe),haber:deCentavos(haber),diferencia:deCentavos(debe-haber),
  descuadrados:{total:descuadrados.length,muestra:muestra(descuadrados)},integridad:{total:incompletos.length,muestra:muestra(incompletos)}};
}
const faltante=(e:unknown)=>['ER_NO_SUCH_TABLE','ER_BAD_FIELD_ERROR'].includes(String((e as {code?:string})?.code));
export async function diagnosticarCierre(empresaId:number,entidadId:number,ejercicioId:number){
 for(const id of [empresaId,entidadId,ejercicioId])if(!Number.isInteger(id)||id<1||id>2147483647)throw new AccesoContable('Identificador inválido.',400);
 const c=await getPool().getConnection();
 try{
  await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');await c.query('START TRANSACTION READ ONLY');
  const [entidades]=await c.query<RowDataPacket[]>('SELECT id,codigo,nombre FROM cont_entidades WHERE empresa_id=? AND id=?',[empresaId,entidadId]);
  if(!entidades[0])throw new AccesoContable('Libro no disponible.',404);
  const [ejercicios]=await c.query<RowDataPacket[]>("SELECT id,codigo,estado,DATE_FORMAT(fecha_inicio,'%Y-%m-%d') fechaInicio,DATE_FORMAT(fecha_fin,'%Y-%m-%d') fechaFin FROM cont_ejercicios WHERE empresa_id=? AND entidad_id=? AND id=?",[empresaId,entidadId,ejercicioId]);
  const ejercicio=ejercicios[0];if(!ejercicio)throw new AccesoContable('Ejercicio no disponible en este libro.',404);
  const [ps]=await c.query<RowDataPacket[]>("SELECT id,ejercicio_id,orden,codigo,estado,DATE_FORMAT(fecha_inicio,'%Y-%m-%d') fechaInicio,DATE_FORMAT(fecha_fin,'%Y-%m-%d') fechaFin FROM cont_periodos WHERE empresa_id=? AND entidad_id=? AND ejercicio_id=? ORDER BY orden",[empresaId,entidadId,ejercicioId]);
  const periodos=ps.map(p=>({...p,inicioEjercicio:ejercicio.fechaInicio,finEjercicio:ejercicio.fechaFin})) as PeriodoControl[];
  const calendario=diagnosticoCalendario(periodos,[]);
  let control:{disponible:boolean;estado:string;version:number|null}={disponible:true,estado:'NO_ACTIVADO',version:null};
  try{const [rows]=await c.query<RowDataPacket[]>('SELECT estado,version FROM cont_control_libro WHERE empresa_id=? AND entidad_id=?',[empresaId,entidadId]);
   if(rows.length>1)control={disponible:true,estado:'INVALIDO',version:null};
   else if(rows[0])control={disponible:true,estado:String(rows[0].estado),version:Number(rows[0].version)};
  }catch(e){if(!faltante(e))throw e;control={disponible:false,estado:'ESQUEMA_NO_DISPONIBLE',version:null};}
  const [rows]=await c.query<RowDataPacket[]>(`SELECT a.id,a.numero,a.estado,DATE_FORMAT(a.fecha,'%Y-%m-%d') fecha,
   CAST(COALESCE(SUM(CASE WHEN d.empresa_id=a.empresa_id AND d.entidad_id=a.entidad_id THEN d.debe ELSE 0 END),0) AS CHAR) debe,
   CAST(COALESCE(SUM(CASE WHEN d.empresa_id=a.empresa_id AND d.entidad_id=a.entidad_id THEN d.haber ELSE 0 END),0) AS CHAR) haber,
   COUNT(d.id) lineas,COALESCE(SUM(CASE WHEN d.id IS NOT NULL AND
    (d.empresa_id IS NULL OR d.entidad_id IS NULL OR d.empresa_id<>a.empresa_id OR d.entidad_id<>a.entidad_id OR cu.id IS NULL OR d.debe IS NULL OR d.haber IS NULL OR NOT ((d.debe>0 AND d.haber=0) OR (d.haber>0 AND d.debe=0))) THEN 1 ELSE 0 END),0) invalidas
   FROM cont_asientos a LEFT JOIN cont_asiento_detalle d ON d.asiento_id=a.id
   LEFT JOIN cont_cuentas cu ON cu.id=d.cuenta_id AND cu.empresa_id=a.empresa_id AND cu.entidad_id=a.entidad_id
   WHERE a.empresa_id=? AND a.entidad_id=? AND a.fecha>=? AND a.fecha<=?
   GROUP BY a.id,a.numero,a.estado,a.fecha ORDER BY a.fecha,a.id`,[empresaId,entidadId,ejercicio.fechaInicio,ejercicio.fechaFin]);
  const asientos=evaluarAsientos(rows as AsientoDiagnostico[]);
  // Un detalle sin padre no tiene fecha atribuible: control básico de todo el libro.
  const [orf]=await c.query<RowDataPacket[]>(`SELECT COUNT(*) total FROM cont_asiento_detalle d LEFT JOIN cont_asientos a ON a.id=d.asiento_id
   WHERE d.empresa_id=? AND d.entidad_id=? AND (a.id IS NULL OR a.empresa_id<>d.empresa_id OR a.entidad_id<>d.entidad_id)`,[empresaId,entidadId]);
  const [historia]=await c.query<RowDataPacket[]>("SELECT COUNT(*) total FROM cont_asientos WHERE empresa_id=? AND entidad_id=? AND estado='Registrado' AND fecha<?",[empresaId,entidadId,ejercicio.fechaInicio]);
  const abiertos=periodos.filter(p=>p.estado==='ABIERTO').map(p=>Number(p.id));
  const noCerrados=periodos.filter(p=>p.estado!=='CERRADO').map(p=>Number(p.id));
  const bloqueantes=[...calendario.bloqueantes];
  if(noCerrados.length)bloqueantes.push('PERIODOS_NO_CERRADOS');
  if(control.estado!=='ACTIVO')bloqueantes.push(control.disponible?'CONTROL_NO_ACTIVO':'CONTROL_NO_DISPONIBLE');
  if(asientos.descuadrados.total)bloqueantes.push('ASIENTOS_DESCUADRADOS');
  if(asientos.integridad.total)bloqueantes.push('INTEGRIDAD_MOVIMIENTOS');
  if(Number(orf[0].total))bloqueantes.push('DETALLES_HUERFANOS_LIBRO');
  const advertencias=['POLITICA_CIERRE_PENDIENTE','REGULARIZACION_NO_VERIFICADA'];
  if(Number(historia[0].total))advertencias.push('HISTORIA_ANTERIOR_AL_EJERCICIO');
  if(asientos.noRegistrados)advertencias.push('ASIENTOS_NO_REGISTRADOS');
  if(!asientos.registrados)advertencias.push('SIN_ASIENTOS_REGISTRADOS');
  const resultado={empresaId,entidadId,ejercicio,periodos,abiertos,noCerrados,control,asientos,
   detallesHuerfanosLibro:Number(orf[0].total),asientosAnteriores:Number(historia[0].total),
   bloqueantes:[...new Set(bloqueantes)],advertencias,generadoEn:new Date().toISOString(),
   estado:bloqueantes.length?'CON_BLOQUEANTES':'SIN_BLOQUEANTES_TECNICOS',
   alcance:'Instantánea de solo lectura. No certifica cierre ni regularización. Los saldos C3C-4 incluyen historia anterior entre ejercicios y no representan apertura formal. No se generan asientos ni se cambian períodos.'};
  await c.commit();return resultado;
 }catch(e){try{await c.rollback();}catch{}throw e;}finally{c.release();}
}
export type DiagnosticoCierre=Awaited<ReturnType<typeof diagnosticarCierre>>;
