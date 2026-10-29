import {aCentavos,deCentavos} from './reportes/calculo';
import {consultarCuentaResultadoTx} from './cuenta-resultado';
import type {PoolConnection,RowDataPacket} from 'mysql2/promise';
import {getPool} from '@/lib/db';
import {AccesoContable} from './ambito';
import {consultarDiagnosticoCierre} from './cierre-diagnostico';
import {calcularRegularizacion,type CuentaSimulacion} from './regularizacion-calculo';

export async function simularRegularizacion(empresaId:number,entidadId:number,ejercicioId:number){
 for(const id of [empresaId,entidadId,ejercicioId])if(!Number.isInteger(id)||id<1||id>2147483647)throw new AccesoContable('Identificador inválido.',400);
 const c=await getPool().getConnection();
 try{
  await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');await c.query('START TRANSACTION READ ONLY');
  const resultado=await consultarRegularizacionTx(c,empresaId,entidadId,ejercicioId);
  await c.commit();return resultado;
 }catch(e){try{await c.rollback();}catch{/* conserva el error original */}throw e;}finally{c.release();}
}
/** Reutiliza la transacción del llamador; no escribe ni abre conexiones adicionales. */
export async function consultarRegularizacionTx(c:PoolConnection,empresaId:number,entidadId:number,ejercicioId:number){
  const diagnostico=await consultarDiagnosticoCierre(c,empresaId,entidadId,ejercicioId);
  const {fechaInicio,fechaFin}=diagnostico.ejercicio;
  const [catalogo]=await c.query<RowDataPacket[]>('SELECT id,codigo,nombre,tipo,activa FROM cont_cuentas WHERE empresa_id=? AND entidad_id=? ORDER BY codigo',[empresaId,entidadId]);
  const [movimientos]=await c.query<RowDataPacket[]>(`SELECT d.cuenta_id,
   CAST(SUM(CASE WHEN a.fecha>=? THEN d.debe ELSE 0 END) AS CHAR) debe,
   CAST(SUM(CASE WHEN a.fecha>=? THEN d.haber ELSE 0 END) AS CHAR) haber,
   CAST(SUM(CASE WHEN a.fecha<? THEN d.debe ELSE 0 END) AS CHAR) debeAnterior,
   CAST(SUM(CASE WHEN a.fecha<? THEN d.haber ELSE 0 END) AS CHAR) haberAnterior
   FROM cont_asientos a JOIN cont_asiento_detalle d ON d.asiento_id=a.id AND d.empresa_id=a.empresa_id AND d.entidad_id=a.entidad_id
   WHERE a.empresa_id=? AND a.entidad_id=? AND a.estado='Registrado' AND a.fecha<=? GROUP BY d.cuenta_id`,
   [fechaInicio,fechaInicio,fechaInicio,fechaInicio,empresaId,entidadId,fechaFin]);
  const mov=new Map(movimientos.map(m=>[Number(m.cuenta_id),m]));
  const cuentas:CuentaSimulacion[]=catalogo.map(c=>{const m=mov.get(Number(c.id));return {cuentaId:Number(c.id),codigo:String(c.codigo),nombre:String(c.nombre),tipo:String(c.tipo),activa:Number(c.activa),debe:String(m?.debe??'0.00'),haber:String(m?.haber??'0.00'),debeAnterior:String(m?.debeAnterior??'0.00'),haberAnterior:String(m?.haberAnterior??'0.00')};});
  // Nunca omitir movimientos con cuenta ausente; no exponer datos de catálogos ajenos.
  const conocidas=new Set(cuentas.map(c=>c.cuentaId));
  for(const m of movimientos)if(!conocidas.has(Number(m.cuenta_id)))cuentas.push({cuentaId:Number(m.cuenta_id),codigo:'(sin cuenta)',nombre:'Cuenta no disponible en este libro',tipo:'SIN_CLASIFICAR',activa:0,debe:String(m.debe),haber:String(m.haber),debeAnterior:String(m.debeAnterior),haberAnterior:String(m.haberAnterior)});
  const calculo=calcularRegularizacion(cuentas);
  const configuracionResultado=await consultarCuentaResultadoTx(c,empresaId,entidadId);
  const bloqueantes=[...diagnostico.bloqueantes,'POLITICA_REGULARIZACION_PENDIENTE'];
  if(!configuracionResultado.cuenta)bloqueantes.push(configuracionResultado.estado==='INVALIDA'?'CUENTA_RESULTADO_INVALIDA':'CUENTA_RESULTADO_NO_CONFIGURADA');
  if(calculo.sinClasificar.length)bloqueantes.push('CLASIFICACION_INSUFICIENTE');
  if(calculo.inactivasConSaldo.length)bloqueantes.push('NOMINALES_INACTIVAS_CON_SALDO');
  const datosValidos=!diagnostico.bloqueantes.some(c=>['ASIENTOS_DESCUADRADOS','INTEGRIDAD_MOVIMIENTOS','DETALLES_HUERFANOS_LIBRO'].includes(c));
  const resultado={empresaId,entidadId,ejercicioId,ejercicio:diagnostico.ejercicio,diagnostico,calculo,
   resultadoConfiable:datosValidos&&calculo.resultadoCompleto,estado:'INCOMPLETA' as const,
   cuentaResultado:configuracionResultado.cuenta,configuracionResultado:configuracionResultado.estado,propuestaCompleta:null,
   movimientoCuentaResultado:configuracionResultado.cuenta?{debe:deCentavos(aCentavos(mov.get(configuracionResultado.cuenta.id)?.debe)),haber:deCentavos(aCentavos(mov.get(configuracionResultado.cuenta.id)?.haber))}:null,bloqueantes:[...new Set(bloqueantes)],
   advertencias:[...diagnostico.advertencias,...(calculo.saldosContrarios.length?['SALDOS_NOMINALES_CONTRARIOS']:[])],
   generadoEn:new Date().toISOString(),
   aviso:'SIMULACIÓN INCOMPLETA. No es un asiento formal ni está lista para contabilizar. Las inversas son indicativas y carecen de contrapartida aprobada. Solo movimientos Registrados del ejercicio; los saldos históricos se muestran separados y no se regularizan. No se guarda ni contabiliza nada.'};
  return resultado;
}
export type SimulacionRegularizacion=Awaited<ReturnType<typeof simularRegularizacion>>;
