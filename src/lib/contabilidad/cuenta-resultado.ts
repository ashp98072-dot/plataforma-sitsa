import type {PoolConnection,RowDataPacket} from 'mysql2/promise';
import {getPool} from '@/lib/db';
import {registrarAuditoriaTx} from '@/lib/auditoria';
import {AccesoContable,bloquearAmbito} from './ambito';
export const ROL_RESULTADO='RESULTADO_EJERCICIO';
export const AVISO_RESULTADO='Configuración técnica: cuenta activa de tipo Capital del mismo libro. El catálogo no define imputabilidad ni jerarquía padre/hijo; nivel no demuestra aptitud. Pendiente aprobar idoneidad específica y política contable. No autoriza regularizar ni contabilizar.';
type Cuenta={id:number;codigo:string;nombre:string;tipo:string;nivel:number};
export function cuentaResultadoElegible(c:Record<string,unknown>){return Number(c.activa)===1&&c.tipo==='Capital';}
export async function consultarCuentaResultadoTx(c:PoolConnection,empresaId:number,entidadId:number):Promise<{cuenta:Cuenta|null;estado:string}>{
 try{
  const [rows]=await c.query<RowDataPacket[]>(`SELECT r.cuenta_id,r.activa rol_activo,cu.id,cu.codigo,cu.nombre,cu.tipo,cu.nivel,cu.activa
   FROM cont_cuentas_rol r LEFT JOIN cont_cuentas cu ON cu.id=r.cuenta_id AND cu.empresa_id=r.empresa_id AND cu.entidad_id=r.entidad_id
   WHERE r.empresa_id=? AND r.entidad_id=? AND r.rol=?`,[empresaId,entidadId,ROL_RESULTADO]);
  if(!rows.length)return {cuenta:null,estado:'NO_CONFIGURADA'};
  const r=rows[0];if(rows.length!==1||!r.id||Number(r.rol_activo)!==1||!cuentaResultadoElegible(r))return {cuenta:null,estado:'INVALIDA'};
  return {cuenta:{id:Number(r.id),codigo:String(r.codigo),nombre:String(r.nombre),tipo:String(r.tipo),nivel:Number(r.nivel)},estado:'VALIDADA_TECNICAMENTE'};
 }catch(e){if(['ER_NO_SUCH_TABLE','ER_BAD_FIELD_ERROR'].includes(String((e as {code?:string}).code)))return {cuenta:null,estado:'ESQUEMA_NO_DISPONIBLE'};throw e;}
}
async function puedeModificar(c:PoolConnection,empresaId:number,usuarioId:number){
 const [u]=await c.query<RowDataPacket[]>(`SELECT u.id FROM usuarios u WHERE u.id=? AND u.activo=1
  AND (u.rol_global='Admin' OR (EXISTS(SELECT 1 FROM usuario_empresa e WHERE e.usuario_id=u.id AND e.empresa_id=?)
   AND EXISTS(SELECT 1 FROM usuario_modulo p WHERE p.usuario_id=u.id AND p.empresa_id IS NULL AND p.modulo='contabilidad' AND p.puede_ver=1 AND p.puede_editar=1)))`,[usuarioId,empresaId]);
 return u.length===1;
}
function ids(...values:number[]){if(values.some(id=>!Number.isInteger(id)||id<1||id>2147483647))throw new AccesoContable('Identificador inválido.',400);}
export async function consultarConfiguracionResultado(empresaId:number,entidadId:number,usuarioId:number){
 ids(empresaId,entidadId,usuarioId);const c=await getPool().getConnection();
 try{await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');await c.query('START TRANSACTION READ ONLY');
  const [entidades]=await c.query<RowDataPacket[]>('SELECT id FROM cont_entidades WHERE empresa_id=? AND id=?',[empresaId,entidadId]);if(!entidades.length)throw new AccesoContable('Libro no disponible.',404);
  const configuracion=await consultarCuentaResultadoTx(c,empresaId,entidadId);
  const [roles]=configuracion.estado==='ESQUEMA_NO_DISPONIBLE'?[[]]:await c.query<RowDataPacket[]>('SELECT cuenta_id FROM cont_cuentas_rol WHERE empresa_id=? AND entidad_id=? AND rol=?',[empresaId,entidadId,ROL_RESULTADO]);
  const [cuentas]=await c.query<RowDataPacket[]>('SELECT id,codigo,nombre,tipo,nivel,activa FROM cont_cuentas WHERE empresa_id=? AND entidad_id=? ORDER BY codigo',[empresaId,entidadId]);
  const editable=await puedeModificar(c,empresaId,usuarioId);await c.commit();
  return {...configuracion,cuentaAnteriorId:roles[0]?Number(roles[0].cuenta_id):null,cuentas:cuentas.filter(cuentaResultadoElegible).map(c=>({id:Number(c.id),codigo:String(c.codigo),nombre:String(c.nombre),nivel:Number(c.nivel)})),puedeModificar:editable,aviso:AVISO_RESULTADO};
 }catch(e){await c.rollback();throw e;}finally{c.release();}
}
export async function guardarCuentaResultado(empresaId:number,entidadId:number,actor:{id:number;username:string},cuentaId:number,cuentaAnteriorId:number|null){
 ids(empresaId,entidadId,actor.id,cuentaId);if(cuentaAnteriorId!==null)ids(cuentaAnteriorId);
 const c=await getPool().getConnection();
 try{await c.beginTransaction();await bloquearAmbito(c,empresaId,{entidadId,usuarioId:actor.id,admin:false},true);
  if(!await puedeModificar(c,empresaId,actor.id))throw new AccesoContable('Sin permiso de modificación contable.',403);
  const [prev]=await c.query<RowDataPacket[]>('SELECT cuenta_id FROM cont_cuentas_rol WHERE empresa_id=? AND entidad_id=? AND rol=? FOR UPDATE',[empresaId,entidadId,ROL_RESULTADO]);
  const anterior=prev[0]?Number(prev[0].cuenta_id):null;
  if(anterior!==cuentaAnteriorId)throw new AccesoContable('La configuración cambió. Actualiza antes de guardar.',409);
  const [rows]=await c.query<RowDataPacket[]>('SELECT id,tipo,activa FROM cont_cuentas WHERE empresa_id=? AND entidad_id=? AND id=? FOR UPDATE',[empresaId,entidadId,cuentaId]);
  if(rows.length!==1||!cuentaResultadoElegible(rows[0]))throw new AccesoContable('Selecciona una cuenta activa de tipo Capital del mismo libro.',422);
  await c.execute('INSERT INTO cont_cuentas_rol(empresa_id,entidad_id,rol,cuenta_id,activa) VALUES (?,?,?,?,1) ON DUPLICATE KEY UPDATE cuenta_id=VALUES(cuenta_id),activa=1',[empresaId,entidadId,ROL_RESULTADO,cuentaId]);
  await registrarAuditoriaTx(c,{empresaId,usuario:actor.username,modulo:'contabilidad',accion:'cuenta_resultado_configurar',detalle:JSON.stringify({actorId:actor.id,empresaId,entidadId,rol:ROL_RESULTADO,cuentaAnteriorId:anterior,cuentaNuevaId:cuentaId})});
  await c.commit();return {guardada:true};
 }catch(e){await c.rollback();throw e;}finally{c.release();}
}
