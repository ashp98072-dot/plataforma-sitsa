import { createHash } from "node:crypto";
import Decimal from "decimal.js";
import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getPool, query } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import { registrarBitacoraFactura } from "./bitacora";
import { SQL_COBRADO } from "./cobrado";

/**
 * CxC-1 — Cobro multi-factura (cabecera `fact_cobros` + aplicaciones `fact_cobro_aplicaciones`) y su anulación.
 *
 * Reglas (todas dentro de UNA transacción, con las facturas bloqueadas `FOR UPDATE` en orden de id):
 *  - Un cobro pertenece a una empresa, una entidad (libro) y UN cliente; solo se aplica a facturas `Emitida` de esa misma empresa, entidad y cliente.
 *  - Aplicaciones parciales; una aplicación por factura; monto total del cobro = Σ aplicaciones (lo calcula el servidor, nunca el cliente).
 *  - Sobreaplicación imposible: el cobrado vigente se lee bajo el bloqueo (pagos legados + aplicaciones vigentes) y cada aplicación <= saldo.
 *  - Idempotencia: clave por (empresa, entidad); mismo contenido = devuelve el cobro original; otro contenido = 409.
 *  - Anular = marcar el cobro ANULADO con motivo, usuario y fecha. Nada se borra: cabecera y aplicaciones quedan para auditoría y dejan de contar en el saldo.
 *  - Una confirmación bancaria ACTIVA vinculada al cobro BLOQUEA la anulación (no se anula en cascada).
 *  - No genera póliza, ni retención, ni notas de crédito, ni anticipos.
 * Convive con `fact_pagos` sin migrarlo: ver `cobrado.ts` (una sola definición de «cobrado»).
 */
export class ErrorCobro extends Error {
  constructor(message: string, public status = 409, public codigo = "CONFLICTO") { super(message); }
}
export type ActorCobro = { empresaId: number; usuarioId: number; usuario: string };

const MONTO = /^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/;
const CLAVE = /^[a-zA-Z0-9_-]{16,80}$/;
export type EntradaCobro = {
  clienteId: number; fechaCobro: string; medioPago?: string | null; referencia?: string | null; observaciones?: string | null;
  claveIdempotencia: string; aplicaciones: { facturaId: number; monto: string }[];
};
type Validada = {
  clienteId: number; fechaCobro: string; medioPago: string | null; referencia: string | null; observaciones: string | null; clave: string;
  aplicaciones: { facturaId: number; monto: string }[]; total: string; huella: string;
};

function fechaValida(v: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00.000Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v;
}
const texto = (v: unknown, max: number, etiqueta: string) => {
  if (v == null) return null;
  const t = String(v).trim();
  if (t.length > max) throw new ErrorCobro(`${etiqueta} no puede exceder ${max} caracteres.`, 400, "DATOS_INVALIDOS");
  return t || null;
};

export function validarCobro(e: EntradaCobro, empresaId: number, entidadId: number): Validada {
  const inv = (m: string) => new ErrorCobro(m, 400, "DATOS_INVALIDOS");
  if (!Number.isInteger(e.clienteId) || e.clienteId <= 0) throw inv("Selecciona el cliente.");
  if (!fechaValida(String(e.fechaCobro))) throw inv("Fecha del cobro inválida.");
  if (typeof e.claveIdempotencia !== "string" || !CLAVE.test(e.claveIdempotencia)) throw inv("Clave de operación inválida. Recarga la pantalla.");
  if (!Array.isArray(e.aplicaciones) || e.aplicaciones.length < 1 || e.aplicaciones.length > 50) throw inv("Aplica el cobro a entre 1 y 50 facturas.");
  const vistos = new Set<number>();
  let total = new Decimal(0);
  const aplicaciones = e.aplicaciones.map((a) => {
    if (!Number.isInteger(a.facturaId) || a.facturaId <= 0) throw inv("Factura inválida en las aplicaciones.");
    if (vistos.has(a.facturaId)) throw inv("Una factura no puede aparecer dos veces en el mismo cobro.");
    vistos.add(a.facturaId);
    if (typeof a.monto !== "string" || !MONTO.test(a.monto) || new Decimal(a.monto).lte(0)) throw inv("Cada monto aplicado debe ser mayor que cero, con máximo dos decimales.");
    total = total.plus(a.monto);
    return { facturaId: a.facturaId, monto: new Decimal(a.monto).toFixed(2) };
  }).sort((x, y) => x.facturaId - y.facturaId);
  const medioPago = texto(e.medioPago, 40, "El medio de pago"), referencia = texto(e.referencia, 120, "La referencia"), observaciones = texto(e.observaciones, 2000, "Las observaciones");
  const huella = createHash("sha256").update(JSON.stringify([
    1, empresaId, entidadId, e.clienteId, e.fechaCobro, medioPago, referencia, observaciones, aplicaciones.map((a) => [a.facturaId, a.monto]),
  ])).digest("hex");
  return { clienteId: e.clienteId, fechaCobro: e.fechaCobro, medioPago, referencia, observaciones, clave: e.claveIdempotencia, aplicaciones, total: total.toFixed(2), huella };
}

async function transaccion<T>(fn: (c: PoolConnection) => Promise<T>): Promise<T> {
  const c = await getPool().getConnection();
  try {
    await c.query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED");
    await c.beginTransaction();
    const r = await fn(c);
    await c.commit();
    return r;
  } catch (e) {
    try { await c.rollback(); } catch { /* conserva el error original */ }
    const code = (e as { code?: string })?.code;
    if (code === "ER_LOCK_DEADLOCK" || code === "ER_LOCK_WAIT_TIMEOUT") throw new ErrorCobro("Operación en conflicto. Actualiza y vuelve a intentar.", 409, "CONFLICTO");
    throw e;
  } finally { c.release(); }
}

/** Cobrado vigente (pagos legados + aplicaciones vigentes) por factura, leído sobre la conexión que ya bloqueó las facturas. */
async function cobradoPorFactura(c: PoolConnection, ids: number[]): Promise<Map<number, Decimal>> {
  const [rows] = await c.query<RowDataPacket[]>(`SELECT factura_id, SUM(monto) AS total FROM ${SQL_COBRADO} WHERE factura_id IN (${ids.map(() => "?").join(",")}) GROUP BY factura_id`, ids);
  return new Map(rows.map((r) => [Number(r.factura_id), new Decimal(String(r.total))]));
}

const num = (v: unknown) => new Decimal(String(v ?? 0)).toFixed(2);

/* ------------------------------------------------------------------ registrar ------------------------------------------------------------------ */
export async function registrarCobro(actor: ActorCobro, entidadId: number, entrada: EntradaCobro): Promise<{ cobro: CobroDetalle; repetido: boolean }> {
  const v = validarCobro(entrada, actor.empresaId, entidadId);
  const existente = async (leer: Lector) => {
    const r = await leer("SELECT id, huella FROM fact_cobros WHERE empresa_id = ? AND entidad_id = ? AND clave_idempotencia = ?", [actor.empresaId, entidadId, v.clave]);
    return r[0] ? { id: Number(r[0].id), huella: String(r[0].huella) } : null;
  };
  const repetido = async (e: { id: number; huella: string }) => {
    if (e.huella !== v.huella) throw new ErrorCobro("Esta clave de operación ya se usó con otro contenido. Recarga la pantalla e intenta de nuevo.", 409, "CLAVE_REUTILIZADA");
    return { cobro: (await obtenerCobro(actor.empresaId, entidadId, e.id))!, repetido: true };
  };
  try {
    return await transaccion(async (c) => {
      const [ent] = await c.query<RowDataPacket[]>("SELECT activa FROM cont_entidades WHERE empresa_id = ? AND id = ? LOCK IN SHARE MODE", [actor.empresaId, entidadId]);
      if (!ent[0] || Number(ent[0].activa) !== 1) throw new ErrorCobro("Entidad no disponible.", 404, "ENTIDAD_NO_DISPONIBLE");
      const previo = await existente(deConexion(c));
      if (previo) return await repetido(previo);

      const ids = v.aplicaciones.map((a) => a.facturaId);
      // Bloqueo en orden de id: dos cobros concurrentes sobre las mismas facturas se serializan sin interbloqueo y el segundo ve lo cobrado por el primero.
      const [facturas] = await c.query<RowDataPacket[]>(
        `SELECT id, entidad_id, cliente_id, estado_admin, monto_total, moneda, numero_factura FROM fact_facturas
          WHERE empresa_id = ? AND id IN (${ids.map(() => "?").join(",")}) ORDER BY id FOR UPDATE`, [actor.empresaId, ...ids]);
      if (facturas.length !== ids.length) throw new ErrorCobro("Alguna de las facturas indicadas no existe en esta empresa.", 404, "FACTURA_NO_ENCONTRADA");
      const doc = (f: RowDataPacket) => String(f.numero_factura ?? `#${f.id}`);
      for (const f of facturas) {
        if (f.entidad_id == null || Number(f.entidad_id) !== entidadId) throw new ErrorCobro(`La factura ${doc(f)} no pertenece a esta entidad (libro contable).`, 409, "ENTIDAD_DISTINTA");
        if (Number(f.cliente_id) !== v.clienteId) throw new ErrorCobro(`La factura ${doc(f)} pertenece a otro cliente: un cobro se aplica a facturas de un solo cliente.`, 409, "CLIENTE_DISTINTO");
        if (String(f.estado_admin) !== "Emitida") throw new ErrorCobro(`La factura ${doc(f)} no está Emitida y no admite cobros.`, 409, "FACTURA_NO_EMITIDA");
      }
      const monedas = new Set(facturas.map((f) => String(f.moneda ?? "GTQ")));
      if (monedas.size !== 1) throw new ErrorCobro("Las facturas de un cobro deben estar en la misma moneda.", 409, "MONEDA_DISTINTA");
      const moneda = [...monedas][0];
      const cobrado = await cobradoPorFactura(c, ids);
      const saldos = new Map<number, Decimal>();
      for (const a of v.aplicaciones) {
        const f = facturas.find((x) => Number(x.id) === a.facturaId)!;
        const saldo = new Decimal(String(f.monto_total)).minus(cobrado.get(a.facturaId) ?? 0);
        if (new Decimal(a.monto).gt(saldo)) throw new ErrorCobro(`El monto aplicado a la factura ${doc(f)} (Q${a.monto}) supera su saldo pendiente (Q${saldo.toFixed(2)}).`, 409, "SOBREAPLICACION");
        saldos.set(a.facturaId, saldo);
      }

      let cobroId: number;
      try {
        const [r] = await c.execute<ResultSetHeader>(
          `INSERT INTO fact_cobros (empresa_id, entidad_id, cliente_id, moneda, fecha_cobro, monto_total, medio_pago, referencia, observaciones, clave_idempotencia, huella, creado_por)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [actor.empresaId, entidadId, v.clienteId, moneda, v.fechaCobro, v.total, v.medioPago, v.referencia, v.observaciones, v.clave, v.huella, actor.usuarioId]);
        cobroId = Number(r.insertId);
      } catch (e) {
        if ((e as { code?: string })?.code === "ER_DUP_ENTRY") throw new ErrorCobro("DUP_CLAVE", 409, "DUP_CLAVE"); // carrera con un envío idéntico: se resuelve fuera de la transacción
        throw e;
      }
      for (const a of v.aplicaciones) {
        await c.execute("INSERT INTO fact_cobro_aplicaciones (empresa_id, entidad_id, cobro_id, factura_id, monto) VALUES (?, ?, ?, ?, ?)", [actor.empresaId, entidadId, cobroId, a.facturaId, a.monto]);
        const f = facturas.find((x) => Number(x.id) === a.facturaId)!;
        const antes = saldos.get(a.facturaId)!, despues = antes.minus(a.monto);
        await registrarBitacoraFactura(c, actor, "registrar_cobro_multiple",
          `Factura #${a.facturaId} · cobro #${cobroId} · aplicado Q${a.monto} · saldo restante Q${despues.toFixed(2)}${v.referencia ? ` · ref. ${v.referencia}` : ""}`,
          { facturaId: a.facturaId, numero: f.numero_factura != null ? String(f.numero_factura) : null, entidadId, monto: a.monto, medioPago: v.medioPago, referencia: v.referencia,
            cambios: [{ campo: "saldo", antes: antes.toFixed(2), despues: despues.toFixed(2) }, { campo: "cobro", antes: null, despues: `#${cobroId}` }] });
      }
      await registrarAuditoriaTx(c, {
        empresaId: actor.empresaId, usuario: actor.usuario, modulo: "contabilidad", accion: "cxc_registrar_cobro",
        detalle: JSON.stringify({ entidadId, cobroId, usuarioId: actor.usuarioId, clienteId: v.clienteId, fechaCobro: v.fechaCobro, montoTotal: v.total, medioPago: v.medioPago,
          referencia: v.referencia, aplicaciones: v.aplicaciones.map((a) => ({ facturaId: a.facturaId, monto: a.monto })) }),
      });
      return { cobro: (await leerCobro(c, actor.empresaId, entidadId, cobroId))!, repetido: false };
    });
  } catch (e) {
    if (e instanceof ErrorCobro && e.codigo === "DUP_CLAVE") {
      const ganador = await existente((sql, params) => query<RowDataPacket[]>(sql, params as never));
      if (ganador) return await repetido(ganador);
      throw new ErrorCobro("Operación en conflicto. Actualiza y vuelve a intentar.", 409, "CONFLICTO");
    }
    throw e;
  }
}

/* ------------------------------------------------------------------ anular ------------------------------------------------------------------ */
export async function anularCobro(actor: ActorCobro, entidadId: number, cobroId: number, motivoEntrada: unknown): Promise<CobroDetalle> {
  if (!Number.isInteger(cobroId) || cobroId <= 0) throw new ErrorCobro("Cobro inválido.", 400, "DATOS_INVALIDOS");
  const motivo = String(motivoEntrada ?? "").trim();
  if (motivo.length < 3) throw new ErrorCobro("Indica el motivo de la anulación (mínimo 3 caracteres).", 400, "MOTIVO_REQUERIDO");
  if (motivo.length > 500) throw new ErrorCobro("El motivo no puede exceder 500 caracteres.", 400, "DATOS_INVALIDOS");
  return transaccion(async (c) => {
    // Mismo orden de bloqueo que registrar y que la confirmación bancaria: primero las FACTURAS (por id), después el cobro.
    const [apl] = await c.query<RowDataPacket[]>("SELECT factura_id FROM fact_cobro_aplicaciones WHERE empresa_id = ? AND entidad_id = ? AND cobro_id = ? ORDER BY factura_id", [actor.empresaId, entidadId, cobroId]);
    if (!apl.length) throw new ErrorCobro("Cobro no encontrado.", 404, "NO_ENCONTRADO");
    const ids = apl.map((a) => Number(a.factura_id));
    await c.query<RowDataPacket[]>(`SELECT id FROM fact_facturas WHERE empresa_id = ? AND id IN (${ids.map(() => "?").join(",")}) ORDER BY id FOR UPDATE`, [actor.empresaId, ...ids]);
    const [cab] = await c.query<RowDataPacket[]>("SELECT id, estado, monto_total FROM fact_cobros WHERE empresa_id = ? AND entidad_id = ? AND id = ? FOR UPDATE", [actor.empresaId, entidadId, cobroId]);
    if (!cab[0]) throw new ErrorCobro("Cobro no encontrado.", 404, "NO_ENCONTRADO");
    if (String(cab[0].estado) === "ANULADO") throw new ErrorCobro("El cobro ya está anulado.", 409, "YA_ANULADO");
    const [conf] = await c.query<RowDataPacket[]>("SELECT id FROM fact_pago_confirmaciones WHERE empresa_id = ? AND cobro_id = ? AND estado = 'CONFIRMADA' FOR UPDATE", [actor.empresaId, cobroId]);
    if (conf.length) throw new ErrorCobro("El cobro tiene una confirmación bancaria activa: anula primero la confirmación bancaria y luego el cobro.", 409, "CONFIRMACION_ACTIVA");

    const [r] = await c.execute<ResultSetHeader>(
      "UPDATE fact_cobros SET estado = 'ANULADO', anulado_por = ?, anulado_en = NOW(), motivo_anulacion = ? WHERE empresa_id = ? AND entidad_id = ? AND id = ? AND estado = 'VIGENTE'",
      [actor.usuarioId, motivo, actor.empresaId, entidadId, cobroId]);
    if (r.affectedRows !== 1) throw new ErrorCobro("El cobro ya está anulado.", 409, "YA_ANULADO");
    const detalle = await leerCobro(c, actor.empresaId, entidadId, cobroId);
    const cobrado = await cobradoPorFactura(c, ids); // ya sin este cobro
    const [facs] = await c.query<RowDataPacket[]>(`SELECT id, monto_total, numero_factura FROM fact_facturas WHERE empresa_id = ? AND id IN (${ids.map(() => "?").join(",")})`, [actor.empresaId, ...ids]);
    for (const a of detalle!.aplicaciones) {
      const f = facs.find((x) => Number(x.id) === a.facturaId)!;
      const despues = new Decimal(String(f.monto_total)).minus(cobrado.get(a.facturaId) ?? 0), antes = despues.minus(a.monto);
      await registrarBitacoraFactura(c, actor, "anular_cobro_multiple",
        `Factura #${a.facturaId} · cobro #${cobroId} anulado · Q${a.monto} · saldo restaurado Q${despues.toFixed(2)}`,
        { facturaId: a.facturaId, numero: f.numero_factura != null ? String(f.numero_factura) : null, entidadId, monto: a.monto, motivo,
          cambios: [{ campo: "saldo", antes: antes.toFixed(2), despues: despues.toFixed(2) }, { campo: "cobro", antes: `#${cobroId}`, despues: "anulado" }] });
    }
    await registrarAuditoriaTx(c, {
      empresaId: actor.empresaId, usuario: actor.usuario, modulo: "contabilidad", accion: "cxc_anular_cobro",
      detalle: JSON.stringify({ entidadId, cobroId, usuarioId: actor.usuarioId, clienteId: detalle!.clienteId, montoTotal: detalle!.montoTotal, motivo,
        antes: "VIGENTE", despues: "ANULADO", aplicaciones: detalle!.aplicaciones.map((a) => ({ facturaId: a.facturaId, monto: a.monto })) }),
    });
    return detalle!;
  });
}

/* ------------------------------------------------------------------ lectura ------------------------------------------------------------------ */
export type AplicacionDetalle = { facturaId: number; numeroFactura: string | null; monto: string };
export type CobroDetalle = {
  id: number; empresaId: number; entidadId: number; clienteId: number; cliente: string; moneda: string; fechaCobro: string; montoTotal: string;
  medioPago: string | null; referencia: string | null; observaciones: string | null; estado: "VIGENTE" | "ANULADO";
  creadoPor: string | null; creadoEn: string; anuladoPor: string | null; anuladoEn: string | null; motivoAnulacion: string | null;
  confirmacionActiva: boolean; aplicaciones: AplicacionDetalle[];
};
const SELECT_COBRO = `SELECT c.id, c.empresa_id, c.entidad_id, c.cliente_id, COALESCE(cl.nombre, '') AS cliente, c.moneda, DATE_FORMAT(c.fecha_cobro, '%Y-%m-%d') AS fecha_cobro,
  c.monto_total, c.medio_pago, c.referencia, c.observaciones, c.estado, uc.username AS creado_por, DATE_FORMAT(c.creado_en, '%Y-%m-%d %H:%i:%s') AS creado_en,
  ua.username AS anulado_por, DATE_FORMAT(c.anulado_en, '%Y-%m-%d %H:%i:%s') AS anulado_en, c.motivo_anulacion,
  EXISTS (SELECT 1 FROM fact_pago_confirmaciones pc WHERE pc.empresa_id = c.empresa_id AND pc.cobro_id = c.id AND pc.estado = 'CONFIRMADA') AS confirmacion_activa
  FROM fact_cobros c LEFT JOIN clientes cl ON cl.id = c.cliente_id AND cl.empresa_id = c.empresa_id
  LEFT JOIN usuarios uc ON uc.id = c.creado_por LEFT JOIN usuarios ua ON ua.id = c.anulado_por`;

type Lector = (sql: string, params: unknown[]) => Promise<RowDataPacket[]>;
const deConexion = (c: PoolConnection): Lector => async (sql, params) => (await c.query<RowDataPacket[]>(sql, params))[0];
const dePool: Lector = (sql, params) => query<RowDataPacket[]>(sql, params as never);

async function mapear(leer: Lector, filas: RowDataPacket[]): Promise<CobroDetalle[]> {
  if (!filas.length) return [];
  const ids = filas.map((r) => Number(r.id));
  const apl = await leer(
    `SELECT a.cobro_id, a.factura_id, a.monto, f.numero_factura FROM fact_cobro_aplicaciones a JOIN fact_facturas f ON f.id = a.factura_id
      WHERE a.cobro_id IN (${ids.map(() => "?").join(",")}) ORDER BY a.cobro_id, a.factura_id`, ids);
  return filas.map((r) => ({
    id: Number(r.id), empresaId: Number(r.empresa_id), entidadId: Number(r.entidad_id), clienteId: Number(r.cliente_id), cliente: String(r.cliente), moneda: String(r.moneda),
    fechaCobro: String(r.fecha_cobro), montoTotal: num(r.monto_total), medioPago: r.medio_pago != null ? String(r.medio_pago) : null,
    referencia: r.referencia != null ? String(r.referencia) : null, observaciones: r.observaciones != null ? String(r.observaciones) : null,
    estado: String(r.estado) === "ANULADO" ? "ANULADO" : "VIGENTE", creadoPor: r.creado_por != null ? String(r.creado_por) : null, creadoEn: String(r.creado_en),
    anuladoPor: r.anulado_por != null ? String(r.anulado_por) : null, anuladoEn: r.anulado_en != null ? String(r.anulado_en) : null,
    motivoAnulacion: r.motivo_anulacion != null ? String(r.motivo_anulacion) : null, confirmacionActiva: Number(r.confirmacion_activa) === 1,
    aplicaciones: apl.filter((a) => Number(a.cobro_id) === Number(r.id)).map((a) => ({ facturaId: Number(a.factura_id), numeroFactura: a.numero_factura != null ? String(a.numero_factura) : null, monto: num(a.monto) })),
  }));
}
async function leerCobro(c: PoolConnection, empresaId: number, entidadId: number, id: number) {
  const [f] = await c.query<RowDataPacket[]>(`${SELECT_COBRO} WHERE c.empresa_id = ? AND c.entidad_id = ? AND c.id = ?`, [empresaId, entidadId, id]);
  return (await mapear(deConexion(c), f))[0] ?? null;
}
export async function obtenerCobro(empresaId: number, entidadId: number, id: number): Promise<CobroDetalle | null> {
  const f = await query<RowDataPacket[]>(`${SELECT_COBRO} WHERE c.empresa_id = ? AND c.entidad_id = ? AND c.id = ?`, [empresaId, entidadId, id]);
  return (await mapear(dePool, f))[0] ?? null;
}

export type FiltrosCobros = { clienteId?: number; estado?: "VIGENTE" | "ANULADO"; desde?: string; hasta?: string; page?: number; pageSize?: number };
export async function listarCobros(empresaId: number, entidadId: number, f: FiltrosCobros = {}) {
  const pageSize = Math.min(Math.max(f.pageSize ?? 25, 1), 100), page = Math.max(f.page ?? 1, 1);
  const w = ["c.empresa_id = ?", "c.entidad_id = ?"]; const p: (string | number)[] = [empresaId, entidadId];
  if (f.clienteId) { w.push("c.cliente_id = ?"); p.push(f.clienteId); }
  if (f.estado) { w.push("c.estado = ?"); p.push(f.estado); }
  if (f.desde) { w.push("c.fecha_cobro >= ?"); p.push(f.desde); }
  if (f.hasta) { w.push("c.fecha_cobro <= ?"); p.push(f.hasta); }
  const donde = w.join(" AND ");
  const [tot] = await query<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM fact_cobros c WHERE ${donde}`, p);
  const filas = await query<RowDataPacket[]>(`${SELECT_COBRO} WHERE ${donde} ORDER BY c.fecha_cobro DESC, c.id DESC LIMIT ? OFFSET ?`, [...p, pageSize, (page - 1) * pageSize]);
  return { cobros: await mapear(dePool, filas), totalReal: Number(tot?.n ?? 0), page, pageSize };
}

/** Clientes del libro con facturas Emitidas con saldo (para elegir a quién se le aplica el cobro). */
export async function clientesConSaldo(empresaId: number, entidadId: number) {
  const rows = await query<RowDataPacket[]>(
    `SELECT f.cliente_id, COALESCE(MAX(f.cliente_nombre_snapshot), MAX(cl.nombre)) AS cliente, COUNT(*) AS facturas, SUM(f.monto_total - COALESCE(pg.total, 0)) AS saldo
       FROM fact_facturas f JOIN clientes cl ON cl.id = f.cliente_id AND cl.empresa_id = f.empresa_id
       LEFT JOIN (SELECT factura_id, SUM(monto) AS total FROM ${SQL_COBRADO} WHERE empresa_id = ? GROUP BY factura_id) pg ON pg.factura_id = f.id
      WHERE f.empresa_id = ? AND f.entidad_id = ? AND f.estado_admin = 'Emitida' AND f.monto_total > COALESCE(pg.total, 0)
      GROUP BY f.cliente_id ORDER BY cliente`, [empresaId, empresaId, entidadId]);
  return rows.map((r) => ({ clienteId: Number(r.cliente_id), cliente: String(r.cliente ?? ""), facturas: Number(r.facturas), saldo: num(r.saldo) }));
}

/** Facturas Emitidas del cliente y libro con saldo > 0: total, cobrado (pagos + aplicaciones vigentes) y saldo. */
export async function facturasPendientesCliente(empresaId: number, entidadId: number, clienteId: number) {
  const rows = await query<RowDataPacket[]>(
    `SELECT f.id, f.numero_factura, DATE_FORMAT(f.fecha_emision, '%Y-%m-%d') AS fecha_emision, f.moneda, f.monto_total, COALESCE(pg.total, 0) AS cobrado
       FROM fact_facturas f
       LEFT JOIN (SELECT factura_id, SUM(monto) AS total FROM ${SQL_COBRADO} WHERE empresa_id = ? GROUP BY factura_id) pg ON pg.factura_id = f.id
      WHERE f.empresa_id = ? AND f.entidad_id = ? AND f.cliente_id = ? AND f.estado_admin = 'Emitida' AND f.monto_total > COALESCE(pg.total, 0)
      ORDER BY f.fecha_emision, f.id LIMIT 200`, [empresaId, empresaId, entidadId, clienteId]);
  return rows.map((r) => ({
    facturaId: Number(r.id), numeroFactura: r.numero_factura != null ? String(r.numero_factura) : null, fechaEmision: String(r.fecha_emision), moneda: String(r.moneda ?? "GTQ"),
    total: num(r.monto_total), cobrado: num(r.cobrado), saldo: new Decimal(String(r.monto_total)).minus(String(r.cobrado)).toFixed(2),
  }));
}
