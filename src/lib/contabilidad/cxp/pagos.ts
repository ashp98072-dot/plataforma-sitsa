import { createHash } from "node:crypto";
import Decimal from "decimal.js";
import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getPool, query } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import { obtenerAplicado } from "./aplicaciones";
import { ErrorCxp, esConflictoTransitorio, esErrorDuplicado } from "./errores";
import { calcularSaldo } from "./saldo";
import { fechaIso, idPositivo, importe, textoOpcional } from "./validacion";

/**
 * M-3B1 — Pagos a proveedores (CxP). Un PAGO pertenece a UN proveedor y a UNA entidad y se aplica a UNA O VARIAS facturas de ese proveedor
 * (`cxp_pago_aplicaciones`); una factura puede recibir VARIOS pagos. El monto total del pago es SIEMPRE la suma de sus aplicaciones (se calcula en
 * el servidor; no existe «pago sin aplicar»: anticipos quedan fuera de esta fase). La retención de ISR NO es una aplicación ni un pago.
 *
 * Seguridad contable:
 *  - Sobreaplicación imposible: dentro de la transacción las facturas se bloquean `FOR UPDATE` (en orden de id, sin interbloqueos entre pagos) y el
 *    pagado vigente se lee bajo ese bloqueo; cada aplicación debe ser <= saldo (monto pagadero − pagado).
 *  - Idempotencia: la clave (UUID del formulario) es única por empresa+entidad; repetir EXACTAMENTE el mismo envío devuelve el pago original,
 *    la misma clave con otro contenido es un 409.
 *  - Reversión: el pago pasa a REVERSADO con usuario/fecha/motivo (la fila y sus aplicaciones se conservan, nada se borra); sus aplicaciones dejan
 *    de contar y el saldo de las facturas se recupera. Auditoría en cada operación.
 *  - Todo acotado por (empresa, entidad) tomados de la sesión/ámbito, nunca del cuerpo.
 */
export type Actor = { id: number; username: string };
export type EstadoPago = "REGISTRADO" | "REVERSADO";
export type EntradaPago = {
  proveedorId?: unknown; fechaPago?: unknown; medioPago?: unknown; referencia?: unknown; observaciones?: unknown; claveIdempotencia?: unknown;
  aplicaciones?: unknown;
};
export type AplicacionPago = { facturaId: number; documento?: string; monto: string };
export type PagoCxp = {
  id: number; empresaId: number; entidadId: number; proveedorId: number; proveedorNombre: string; fechaPago: string; montoTotal: string; medioPago: string;
  referencia: string; observaciones: string | null; estado: EstadoPago; creadoPor: number; creadoEn: string; reversadoPor: number | null;
  reversadoEn: string | null; motivoReversion: string | null; aplicaciones: AplicacionPago[];
};

export const MAX_APLICACIONES = 50;
const CLAVE_RE = /^[A-Za-z0-9_-]{8,64}$/;

export type PagoValidado = {
  proveedorId: number; fechaPago: string; medioPago: string; referencia: string; observaciones: string | null; clave: string;
  aplicaciones: { facturaId: number; monto: string }[]; montoTotal: string; huella: string;
};

/** Validación pura (sin BD). El total y la huella se calculan aquí: el cliente nunca los envía. */
export function validarPago(e: EntradaPago): PagoValidado {
  const proveedorId = idPositivo(e.proveedorId, "Proveedor");
  const fechaPago = fechaIso(e.fechaPago, "Fecha del pago");
  const medioPago = textoOpcional(e.medioPago, 40, "Medio de pago");
  const referencia = textoOpcional(e.referencia, 120, "Referencia");
  const observaciones = textoOpcional(e.observaciones, 500, "Observaciones") || null;
  const clave = typeof e.claveIdempotencia === "string" ? e.claveIdempotencia.trim() : "";
  if (!CLAVE_RE.test(clave)) throw new ErrorCxp("Clave de operación inválida. Recarga la pantalla e intenta de nuevo.", 400, "CLAVE_INVALIDA");
  if (!Array.isArray(e.aplicaciones) || e.aplicaciones.length === 0) throw new ErrorCxp("Indica al menos una factura a pagar.", 400, "SIN_APLICACIONES");
  if (e.aplicaciones.length > MAX_APLICACIONES) throw new ErrorCxp(`Un pago admite hasta ${MAX_APLICACIONES} facturas.`, 400, "DEMASIADAS_APLICACIONES");
  const vistas = new Set<number>();
  let total = new Decimal(0);
  const aplicaciones = e.aplicaciones.map((a, i) => {
    if (!a || typeof a !== "object" || Array.isArray(a)) throw new ErrorCxp(`Aplicación ${i + 1}: formato inválido.`, 400, "APLICACION_INVALIDA");
    const o = a as Record<string, unknown>;
    const facturaId = idPositivo(o.facturaId, `Factura de la aplicación ${i + 1}`);
    if (vistas.has(facturaId)) throw new ErrorCxp("Una factura no puede repetirse dentro del mismo pago: suma sus montos en una sola línea.", 400, "FACTURA_REPETIDA");
    vistas.add(facturaId);
    const monto = importe(o.monto, `Monto de la aplicación ${i + 1}`);
    total = total.plus(monto);
    return { facturaId, monto };
  }).sort((a, b) => a.facturaId - b.facturaId);
  const montoTotal = total.toFixed(2);
  if (new Decimal(montoTotal).gt("999999999999.99")) throw new ErrorCxp("Monto total fuera de rango.", 400, "IMPORTE_INVALIDO");
  const huella = createHash("sha256").update(JSON.stringify({ proveedorId, fechaPago, medioPago, referencia, observaciones, aplicaciones })).digest("hex");
  return { proveedorId, fechaPago, medioPago, referencia, observaciones, clave, aplicaciones, montoTotal, huella };
}

type Conexion = Pick<PoolConnection, "query">;

const SELECT_PAGO = `SELECT p.id, p.empresa_id, p.entidad_id, p.proveedor_id, pr.nombre_comercial, DATE_FORMAT(p.fecha_pago,'%Y-%m-%d') AS fecha_pago, p.monto_total,
  p.medio_pago, p.referencia, p.observaciones, p.estado, p.creado_por, DATE_FORMAT(p.creado_en,'%Y-%m-%d %H:%i:%s') AS creado_en, p.reversado_por,
  DATE_FORMAT(p.reversado_en,'%Y-%m-%d %H:%i:%s') AS reversado_en, p.motivo_reversion
  FROM cxp_pagos p JOIN compras_proveedores pr ON pr.empresa_id = p.empresa_id AND pr.id = p.proveedor_id`;

async function cargarAplicaciones(empresaId: number, entidadId: number, pagoIds: number[]): Promise<Map<number, AplicacionPago[]>> {
  const mapa = new Map<number, AplicacionPago[]>(pagoIds.map(id => [id, []]));
  if (!pagoIds.length) return mapa;
  const rows = await query<RowDataPacket[]>(
    `SELECT a.pago_id, a.factura_id, a.monto, f.serie, f.numero FROM cxp_pago_aplicaciones a
       JOIN cxp_facturas f ON f.empresa_id = a.empresa_id AND f.entidad_id = a.entidad_id AND f.id = a.factura_id
      WHERE a.empresa_id = ? AND a.entidad_id = ? AND a.pago_id IN (${pagoIds.map(() => "?").join(",")}) ORDER BY a.pago_id, a.factura_id`,
    [empresaId, entidadId, ...pagoIds]);
  for (const r of rows) mapa.get(Number(r.pago_id))!.push({ facturaId: Number(r.factura_id), documento: `${r.serie ? `${r.serie}-` : ""}${r.numero}`, monto: new Decimal(String(r.monto)).toFixed(2) });
  return mapa;
}

function mapearPago(r: RowDataPacket, aplicaciones: AplicacionPago[]): PagoCxp {
  return {
    id: Number(r.id), empresaId: Number(r.empresa_id), entidadId: Number(r.entidad_id), proveedorId: Number(r.proveedor_id), proveedorNombre: String(r.nombre_comercial),
    fechaPago: String(r.fecha_pago), montoTotal: new Decimal(String(r.monto_total)).toFixed(2), medioPago: String(r.medio_pago), referencia: String(r.referencia),
    observaciones: r.observaciones == null ? null : String(r.observaciones), estado: String(r.estado) as EstadoPago, creadoPor: Number(r.creado_por),
    creadoEn: String(r.creado_en), reversadoPor: r.reversado_por == null ? null : Number(r.reversado_por), reversadoEn: r.reversado_en == null ? null : String(r.reversado_en),
    motivoReversion: r.motivo_reversion == null ? null : String(r.motivo_reversion), aplicaciones,
  };
}

export async function obtenerPago(empresaId: number, entidadId: number, id: number): Promise<PagoCxp | null> {
  const rows = await query<RowDataPacket[]>(`${SELECT_PAGO} WHERE p.empresa_id = ? AND p.entidad_id = ? AND p.id = ?`, [empresaId, entidadId, id]);
  if (!rows[0]) return null;
  return mapearPago(rows[0], (await cargarAplicaciones(empresaId, entidadId, [id])).get(id) ?? []);
}

export type FiltrosPagos = { proveedorId?: number; facturaId?: number; estado?: EstadoPago; desde?: string; hasta?: string; page?: number; pageSize?: number };
export async function listarPagos(empresaId: number, entidadId: number, f: FiltrosPagos = {}) {
  const pageSize = Math.min(Math.max(f.pageSize ?? 25, 1), 100), page = Math.max(f.page ?? 1, 1);
  const w = ["p.empresa_id = ?", "p.entidad_id = ?"]; const params: (string | number)[] = [empresaId, entidadId];
  if (f.proveedorId) { w.push("p.proveedor_id = ?"); params.push(f.proveedorId); }
  if (f.estado) { w.push("p.estado = ?"); params.push(f.estado); }
  if (f.desde) { w.push("p.fecha_pago >= ?"); params.push(f.desde); }
  if (f.hasta) { w.push("p.fecha_pago <= ?"); params.push(f.hasta); }
  if (f.facturaId) { w.push("EXISTS (SELECT 1 FROM cxp_pago_aplicaciones a WHERE a.empresa_id = p.empresa_id AND a.entidad_id = p.entidad_id AND a.pago_id = p.id AND a.factura_id = ?)"); params.push(f.facturaId); }
  const donde = w.join(" AND ");
  const [tot] = await query<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM cxp_pagos p WHERE ${donde}`, params);
  const rows = await query<RowDataPacket[]>(`${SELECT_PAGO} WHERE ${donde} ORDER BY p.fecha_pago DESC, p.id DESC LIMIT ? OFFSET ?`, [...params, pageSize, (page - 1) * pageSize]);
  const apl = await cargarAplicaciones(empresaId, entidadId, rows.map(r => Number(r.id)));
  return { total: Number(tot?.n ?? 0), page, pageSize, pagos: rows.map(r => mapearPago(r, apl.get(Number(r.id)) ?? [])) };
}

async function pagoPorClave(c: Conexion, empresaId: number, entidadId: number, clave: string) {
  const [rows] = await c.query<RowDataPacket[]>("SELECT id, huella FROM cxp_pagos WHERE empresa_id = ? AND entidad_id = ? AND clave_idempotencia = ?", [empresaId, entidadId, clave]);
  return rows[0] ? { id: Number(rows[0].id), huella: String(rows[0].huella) } : null;
}

export async function registrarPago(empresaId: number, entidadId: number, actor: Actor, entrada: EntradaPago): Promise<{ pago: PagoCxp; repetido: boolean }> {
  const v = validarPago(entrada);
  const conn = await getPool().getConnection();
  const respuestaRepetida = async (existente: { id: number; huella: string }) => {
    if (existente.huella !== v.huella) throw new ErrorCxp("Esta clave de operación ya se usó con otro contenido. Recarga la pantalla e intenta de nuevo.", 409, "CLAVE_REUTILIZADA");
    return { pago: (await obtenerPago(empresaId, entidadId, existente.id))!, repetido: true };
  };
  try {
    await conn.query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED");
    await conn.beginTransaction();
    const [entidad] = await conn.query<RowDataPacket[]>("SELECT activa FROM cont_entidades WHERE empresa_id = ? AND id = ? LOCK IN SHARE MODE", [empresaId, entidadId]);
    if (!entidad[0] || Number(entidad[0].activa) !== 1) throw new ErrorCxp("Entidad no disponible.", 404, "ENTIDAD_NO_DISPONIBLE");

    const previo = await pagoPorClave(conn, empresaId, entidadId, v.clave);
    if (previo) { await conn.rollback(); return await respuestaRepetida(previo); }

    const ids = v.aplicaciones.map(a => a.facturaId);
    // Bloqueo en orden de id: dos pagos concurrentes sobre las mismas facturas se serializan (sin interbloqueo) y el segundo ve el pagado del primero.
    const [facturas] = await conn.query<RowDataPacket[]>(
      `SELECT id, proveedor_id, estado_admin, total_neto_pagar, serie, numero FROM cxp_facturas
        WHERE empresa_id = ? AND entidad_id = ? AND id IN (${ids.map(() => "?").join(",")}) ORDER BY id FOR UPDATE`, [empresaId, entidadId, ...ids]);
    if (facturas.length !== ids.length) throw new ErrorCxp("Alguna de las facturas indicadas no existe en esta entidad.", 404, "FACTURA_NO_ENCONTRADA");
    const aplicado = await obtenerAplicado(empresaId, entidadId, ids, conn);
    const porId = new Map(facturas.map(f => [Number(f.id), f]));
    for (const a of v.aplicaciones) {
      const f = porId.get(a.facturaId)!;
      const doc = `${f.serie ? `${f.serie}-` : ""}${f.numero}`;
      if (Number(f.proveedor_id) !== v.proveedorId) throw new ErrorCxp(`La factura ${doc} pertenece a otro proveedor: un pago se aplica a facturas de un solo proveedor.`, 409, "PROVEEDOR_DISTINTO");
      if (String(f.estado_admin) !== "REGISTRADA") throw new ErrorCxp(`La factura ${doc} está anulada y no admite pagos.`, 409, "FACTURA_ANULADA");
      const saldo = calcularSaldo({ totalNetoPagar: String(f.total_neto_pagar) }, aplicado.get(a.facturaId) ?? "0.00");
      if (new Decimal(a.monto).gt(saldo)) {
        throw new ErrorCxp(`El monto aplicado a la factura ${doc} (Q${a.monto}) supera su saldo pendiente (Q${saldo}).`, 409, "SOBREAPLICACION");
      }
    }

    let pagoId: number;
    try {
      const [r] = await conn.execute<ResultSetHeader>(
        `INSERT INTO cxp_pagos (empresa_id, entidad_id, proveedor_id, fecha_pago, monto_total, medio_pago, referencia, observaciones, clave_idempotencia, huella, creado_por)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [empresaId, entidadId, v.proveedorId, v.fechaPago, v.montoTotal, v.medioPago, v.referencia, v.observaciones, v.clave, v.huella, actor.id]);
      pagoId = Number(r.insertId);
    } catch (e) {
      if (esErrorDuplicado(e)) {
        // Carrera con un envío idéntico: el otro ya confirmó. Se resuelve como repetido (o 409 si el contenido difiere).
        await conn.rollback();
        const ganador = await pagoPorClave({ query: (s: string, p?: unknown[]) => getPool().query(s, p) } as Conexion, empresaId, entidadId, v.clave);
        if (ganador) return await respuestaRepetida(ganador);
      }
      throw e;
    }
    for (const a of v.aplicaciones) {
      await conn.execute("INSERT INTO cxp_pago_aplicaciones (empresa_id, entidad_id, pago_id, factura_id, monto) VALUES (?, ?, ?, ?, ?)", [empresaId, entidadId, pagoId, a.facturaId, a.monto]);
    }
    await registrarAuditoriaTx(conn, {
      empresaId, usuario: actor.username, modulo: "contabilidad", accion: "cxp_registrar_pago",
      detalle: JSON.stringify({ entidadId, pagoId, usuarioId: actor.id, proveedorId: v.proveedorId, fechaPago: v.fechaPago, montoTotal: v.montoTotal,
        medioPago: v.medioPago, referencia: v.referencia, aplicaciones: v.aplicaciones }),
    });
    await conn.commit();
    return { pago: (await obtenerPago(empresaId, entidadId, pagoId))!, repetido: false };
  } catch (e) {
    try { await conn.rollback(); } catch { /* conserva el error original */ }
    if (esConflictoTransitorio(e)) throw new ErrorCxp("Operación en conflicto. Actualiza y vuelve a intentar.", 409, "CONFLICTO");
    throw e;
  } finally { conn.release(); }
}

/** Reversa el pago COMPLETO (no hay reversa parcial en esta fase): queda REVERSADO con motivo, usuario y fecha; sus aplicaciones dejan de contar. */
export async function reversarPago(empresaId: number, entidadId: number, id: unknown, actor: Actor, motivoEntrada: unknown): Promise<PagoCxp> {
  const pagoId = idPositivo(id, "Pago");
  const motivo = textoOpcional(motivoEntrada, 500, "Motivo");
  if (motivo.length < 3) throw new ErrorCxp("Indica el motivo de la reversión (mínimo 3 caracteres).", 400, "MOTIVO_REQUERIDO");
  const conn = await getPool().getConnection();
  try {
    await conn.query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED");
    await conn.beginTransaction();
    const [rows] = await conn.query<RowDataPacket[]>("SELECT id, estado, monto_total, proveedor_id FROM cxp_pagos WHERE empresa_id = ? AND entidad_id = ? AND id = ? FOR UPDATE", [empresaId, entidadId, pagoId]);
    if (!rows[0]) throw new ErrorCxp("Pago no encontrado.", 404, "NO_ENCONTRADO");
    if (String(rows[0].estado) === "REVERSADO") throw new ErrorCxp("El pago ya está reversado.", 409, "YA_REVERSADO");
    const [apl] = await conn.query<RowDataPacket[]>("SELECT factura_id, monto FROM cxp_pago_aplicaciones WHERE empresa_id = ? AND entidad_id = ? AND pago_id = ? ORDER BY factura_id", [empresaId, entidadId, pagoId]);
    await conn.execute("UPDATE cxp_pagos SET estado = 'REVERSADO', reversado_por = ?, reversado_en = NOW(), motivo_reversion = ? WHERE empresa_id = ? AND entidad_id = ? AND id = ?", [actor.id, motivo, empresaId, entidadId, pagoId]);
    await registrarAuditoriaTx(conn, {
      empresaId, usuario: actor.username, modulo: "contabilidad", accion: "cxp_reversar_pago",
      detalle: JSON.stringify({ entidadId, pagoId, usuarioId: actor.id, proveedorId: Number(rows[0].proveedor_id), montoTotal: new Decimal(String(rows[0].monto_total)).toFixed(2), motivo,
        aplicaciones: apl.map(a => ({ facturaId: Number(a.factura_id), monto: new Decimal(String(a.monto)).toFixed(2) })), antes: "REGISTRADO", despues: "REVERSADO" }),
    });
    await conn.commit();
  } catch (e) {
    try { await conn.rollback(); } catch { /* conserva el error original */ }
    if (esConflictoTransitorio(e)) throw new ErrorCxp("Operación en conflicto. Actualiza y vuelve a intentar.", 409, "CONFLICTO");
    throw e;
  } finally { conn.release(); }
  return (await obtenerPago(empresaId, entidadId, pagoId))!;
}
