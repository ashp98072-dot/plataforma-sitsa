import { createHmac, timingSafeEqual } from 'node:crypto';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { getPool } from '@/lib/db';
import { getAuthSecretBytes } from '@/lib/auth-secret';
import { registrarAuditoriaTx } from '@/lib/auditoria';
import { calcularVencimiento, fechaCredito, perfilCreditoSchema, REGLA_VENCIMIENTO } from './vencimiento';
import { SQL_ESQUEMA_CREDITO } from './credito-esquema';

export class ErrorCredito extends Error {
  constructor(message: string, public status = 409) { super(message); }
}
export type ActorCredito = { empresaId: number; usuarioId: number; usuario: string };
const ausente = (e: unknown) => (e as { code?: string })?.code === 'ER_NO_SUCH_TABLE';
async function exigirEsquema(c: PoolConnection) {
  const [r] = await c.query<RowDataPacket[]>(SQL_ESQUEMA_CREDITO);
  if (r[0]?.estado !== 'FINAL') throw new ErrorCredito('Esquema MIL-IMP-04A pendiente o divergente. No se confirmó el vencimiento.', 503);
}
export function respuestaErrorCredito(e: unknown): { error: string; status: number } {
  if (e instanceof ErrorCredito) return { error: e.message, status: e.status };
  if (ausente(e)) return { error: 'Esquema MIL-IMP-04A pendiente.', status: 503 };
  if (['ER_DUP_ENTRY','ER_LOCK_DEADLOCK','ER_LOCK_WAIT_TIMEOUT'].includes((e as { code?: string })?.code ?? '')) return { error: 'Operación concurrente. Consulta y reconfirma.', status: 409 };
  return { error: 'No se pudo completar la operación de crédito.', status: 500 };
}
const firma = (s: string) => createHmac('sha256', getAuthSecretBytes()).update(`MIL04A:${s}`).digest('hex');
function tokenPara(contenido: unknown, expira = Date.now() + 15 * 60_000) {
  const cuerpo = Buffer.from(JSON.stringify({ contenido, expira })).toString('base64url');
  return `${cuerpo}.${firma(cuerpo)}`;
}
function verificarToken(token: string | undefined, contenido: unknown) {
  if (!token || token.length > 4000) return false;
  const [cuerpo, sig, extra] = token.split('.');
  if (extra || !cuerpo || !/^[a-f0-9]{64}$/.test(sig ?? '')) return false;
  if (!timingSafeEqual(Buffer.from(firma(cuerpo), 'hex'), Buffer.from(sig, 'hex'))) return false;
  try {
    const r = JSON.parse(Buffer.from(cuerpo, 'base64url').toString());
    return r.expira > Date.now() && JSON.stringify(r.contenido) === JSON.stringify(contenido);
  } catch { return false; }
}
async function ambito(c: PoolConnection, empresa: number, entidad: number, cliente: number) {
  const [e] = await c.query<RowDataPacket[]>('SELECT id FROM cont_entidades WHERE empresa_id=? AND id=? AND activa=1 LOCK IN SHARE MODE', [empresa, entidad]);
  const [cl] = await c.query<RowDataPacket[]>('SELECT id FROM clientes WHERE empresa_id=? AND id=? FOR UPDATE', [empresa, cliente]);
  if (e.length !== 1 || cl.length !== 1) throw new ErrorCredito('Cliente o entidad fuera del ámbito autorizado.', 404);
}
export async function obtenerPerfilCredito(empresa: number, entidad: number, cliente: number) {
  const c = await getPool().getConnection();
  try {
    await c.beginTransaction(); await ambito(c, empresa, entidad, cliente);
    const [r] = await c.query<RowDataPacket[]>('SELECT dias, aprobada, revision FROM fact_credito_perfiles WHERE empresa_id=? AND entidad_id=? AND cliente_id=?', [empresa, entidad, cliente]);
    await c.commit(); return r[0] ?? null;
  } catch (e) { await c.rollback(); throw e; } finally { c.release(); }
}
export async function guardarPerfilCredito(actor: ActorCredito, entidad: number, cliente: number, entrada: unknown) {
  const parsed = perfilCreditoSchema.safeParse(entrada);
  if (!parsed.success) throw new ErrorCredito('Perfil inválido: plazo 0–365, revisión y motivo obligatorios.', 400);
  const v = parsed.data, c = await getPool().getConnection();
  try {
    await c.beginTransaction(); await exigirEsquema(c); await ambito(c, actor.empresaId, entidad, cliente);
    // Serializar creación/edición por cliente; orden coherente con ambito().
    await c.query('SELECT id FROM clientes WHERE empresa_id=? AND id=? FOR UPDATE', [actor.empresaId, cliente]);
    const [r] = await c.query<RowDataPacket[]>('SELECT dias, aprobada, revision FROM fact_credito_perfiles WHERE empresa_id=? AND entidad_id=? AND cliente_id=? FOR UPDATE', [actor.empresaId, entidad, cliente]);
    if (Number(r[0]?.revision ?? 0) !== v.revision) throw new ErrorCredito('El perfil cambió. Consulta y reconfirma.');
    if (r.length) await c.execute('UPDATE fact_credito_perfiles SET dias=?,aprobada=?,revision=revision+1,actualizado_por=?,actualizado_en=NOW() WHERE empresa_id=? AND entidad_id=? AND cliente_id=?', [v.dias, v.aprobada ? 1 : 0, actor.usuarioId, actor.empresaId, entidad, cliente]);
    else await c.execute('INSERT INTO fact_credito_perfiles (empresa_id,entidad_id,cliente_id,dias,aprobada,revision,actualizado_por) VALUES (?,?,?,?,?,1,?)', [actor.empresaId, entidad, cliente, v.dias, v.aprobada ? 1 : 0, actor.usuarioId]);
    await registrarAuditoriaTx(c, { empresaId: actor.empresaId, usuario: actor.usuario, modulo: 'facturacion', accion: 'configurar_credito_cliente', detalle: JSON.stringify({ entidadId: entidad, clienteId: cliente, antes: r[0] ?? null, despues: { dias: v.dias, aprobada: v.aprobada, revision: v.revision + 1 }, motivo: v.motivo, usuarioId: actor.usuarioId }) });
    await c.commit(); return { revision: v.revision + 1 };
  } catch (e) { await c.rollback(); throw e; } finally { c.release(); }
}

async function propuesta(c: PoolConnection, actor: ActorCredito, facturaId: number, fecha: string) {
  if (!fechaCredito.safeParse(fecha).success) throw new ErrorCredito('Fecha de emisión inválida.', 400);
  let f: RowDataPacket[];
  try {
    [f] = await c.query<RowDataPacket[]>('SELECT id,cliente_id,entidad_id,condicion_pago,estado_admin FROM fact_facturas WHERE empresa_id=? AND id=? FOR UPDATE', [actor.empresaId, facturaId]);
  } catch (e) {
    // Modelo anterior a FACT-4: no incorporar silenciosamente al circuito certificado.
    if ((e as { code?: string })?.code === 'ER_BAD_FIELD_ERROR') {
      const [base] = await c.query<RowDataPacket[]>('SELECT id,estado_admin FROM fact_facturas WHERE empresa_id=? AND id=? FOR UPDATE', [actor.empresaId,facturaId]);
      if(base.length!==1) throw new ErrorCredito('Factura no encontrada.',404);
      if(base[0].estado_admin!=='Borrador') throw new ErrorCredito('Solo se calcula el vencimiento de un borrador.');
      const [columnas] = await c.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='fact_facturas' AND COLUMN_NAME IN ('entidad_id','condicion_pago')");
      if(Number(columnas[0].n)!==0) throw new ErrorCredito('Esquema FACT-4 parcial o divergente.',503);
      return { certificado: false as const, motivo: 'Esquema anterior a FACT-4: sin vencimiento determinado.' };
    }
    throw e;
  }
  if (!f[0]) throw new ErrorCredito('Factura no encontrada.', 404);
  if (f[0].estado_admin !== 'Borrador') throw new ErrorCredito('Solo se calcula el vencimiento de un borrador.');
  if (f[0].entidad_id == null || !['CREDITO', 'CONTADO'].includes(String(f[0].condicion_pago))) {
    return { certificado: false as const, motivo: 'Sin entidad o condición explícita: emisión compatible sin vencimiento determinado.' };
  }
  const entidad = Number(f[0].entidad_id), cliente = Number(f[0].cliente_id);
  await exigirEsquema(c);
  await ambito(c, actor.empresaId, entidad, cliente);
  // Ambas tablas son prerrequisito del circuito certificado, incluso para contado.
  await c.query('SELECT factura_id FROM fact_vencimientos WHERE factura_id=?', [facturaId]);
  let dias = 0, revision = 0;
  if (f[0].condicion_pago === 'CREDITO') {
    const [r] = await c.query<RowDataPacket[]>('SELECT dias,aprobada,revision FROM fact_credito_perfiles WHERE empresa_id=? AND entidad_id=? AND cliente_id=? LOCK IN SHARE MODE', [actor.empresaId, entidad, cliente]);
    if (r.length !== 1 || Number(r[0].aprobada) !== 1) throw new ErrorCredito('Crédito sin plazo explícito aprobado para este cliente y libro.');
    dias = Number(r[0].dias); revision = Number(r[0].revision);
  }
  const snapshot = { empresaId: actor.empresaId, entidadId: entidad, clienteId: cliente, facturaId, fechaBase: fecha, dias, vencimiento: calcularVencimiento(fecha, dias), regla: REGLA_VENCIMIENTO, fuente: revision ? 'PERFIL' : 'CONTADO', revision };
  return { certificado: true as const, snapshot };
}
export async function previsualizarVencimiento(actor: ActorCredito, facturaId: number, fecha: string) {
  const c = await getPool().getConnection();
  try {
    await c.beginTransaction(); const p = await propuesta(c, actor, facturaId, fecha);
    await c.commit();
    return { ...p, token: tokenPara({ p, usuarioId: actor.usuarioId }) };
  } catch (e) { await c.rollback(); throw e; } finally { c.release(); }
}
/** Caller posee la transacción y el lock de factura. Nunca confiar en fecha/plazo final del HTTP. */
export async function congelarVencimientoTx(c: PoolConnection, actor: ActorCredito, facturaId: number, fecha: string, token?: string) {
  const p = await propuesta(c, actor, facturaId, fecha);
  if (!p.certificado) return; // Legado sin entidad/condición: NO inventar snapshot.
  if (!verificarToken(token, { p, usuarioId: actor.usuarioId })) throw new ErrorCredito('Revisa y confirma de nuevo el vencimiento: cambió la factura, fecha o perfil, o expiró la vista previa.');
  const s = p.snapshot;
  await c.execute('INSERT INTO fact_vencimientos (factura_id,empresa_id,entidad_id,cliente_id,fecha_base,dias,vencimiento,regla,fuente,revision,creado_por) VALUES (?,?,?,?,?,?,?,?,?,?,?)', [facturaId, actor.empresaId, s.entidadId, s.clienteId, s.fechaBase, s.dias, s.vencimiento, s.regla, s.fuente, s.revision, actor.usuarioId]);
  await registrarAuditoriaTx(c, { empresaId: actor.empresaId, usuario: actor.usuario, modulo: 'facturacion', accion: 'congelar_vencimiento', detalle: JSON.stringify({ ...s, usuarioId: actor.usuarioId }) });
}
export async function leerVencimiento(empresa: number, factura: number) {
  try {
    const [r] = await getPool().query<RowDataPacket[]>("SELECT DATE_FORMAT(fecha_base,'%Y-%m-%d') AS fechaBase,dias,DATE_FORMAT(vencimiento,'%Y-%m-%d') AS vencimiento,regla,fuente,revision FROM fact_vencimientos WHERE empresa_id=? AND factura_id=?", [empresa, factura]);
    return r[0] ?? null;
  } catch (e) { if (ausente(e)) return null; throw e; }
}
/** Lote de lectura: sin N+1 y sin recalcular con perfiles actuales. Compatible con esquema anterior. */
export async function leerVencimientos(empresa: number, ids: number[]): Promise<Map<number, string>> {
  if (!ids.length) return new Map();
  try {
    const [rows] = await getPool().query<RowDataPacket[]>(`SELECT factura_id,DATE_FORMAT(vencimiento,'%Y-%m-%d') AS fecha FROM fact_vencimientos WHERE empresa_id=? AND factura_id IN (${ids.map(()=>'?').join(',')})`, [empresa, ...ids]);
    return new Map(rows.map(r=>[Number(r.factura_id),String(r.fecha)]));
  } catch(e) { if(ausente(e)) return new Map(); throw e; }
}
