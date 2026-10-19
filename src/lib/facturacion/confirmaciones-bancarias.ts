import type { z } from "zod";
import { createHash } from "crypto";
import Decimal from "decimal.js";
import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getPool } from "@/lib/db";
import { registrarBitacoraFactura } from "./bitacora";
import { confirmacionBancariaSchema, motivoBloqueoBancario, BLOQUEO_MONEDA, type ConfirmacionBancariaInput } from "./confirmacion-bancaria-schema";

export class ErrorConfirmacionBancaria extends Error {
  constructor(message: string, public status = 409) { super(message); }
}
export type ActorBancario = { empresaId: number; usuarioId: number; usuario: string };
export type EvidenciaBancaria = { ruta: string; nombre: string; mime: string; tamano: number; sha256: string };
interface HistorialBancario extends RowDataPacket {
  id: number; pago_id: number | null; monto: string; motivo_anulacion: string | null;
}
export function huellaConfirmacion(empresaId: number, entidadId: number, facturaId: number, input: Omit<ConfirmacionBancariaInput, "cobroId"> & { cobroId?: number | null }, evidencia: EvidenciaBancaria | null) {
  return createHash("sha256").update(JSON.stringify([
    1, empresaId, entidadId, facturaId, input.pagoId, input.cuentaBancariaId,
    new Decimal(input.monto).toFixed(2), input.fechaAcreditacion, input.referencia.trim(),
    input.observaciones?.trim() || null, evidencia?.sha256 ?? null,
    // Solo cuando hay cobro: así la huella de las confirmaciones existentes (sin cobro) no cambia.
    ...(input.cobroId != null ? ["cobro", input.cobroId] : []),
  ])).digest("hex");
}
async function transaccion<T>(fn: (c: PoolConnection) => Promise<T>) {
  const c = await getPool().getConnection();
  try { await c.query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED"); await c.beginTransaction(); const r = await fn(c); await c.commit(); return r; }
  catch (e) { await c.rollback(); throw e; } finally { c.release(); }
}
async function facturaBloqueada(c: PoolConnection, empresaId: number, facturaId: number) {
  const [rows] = await c.query<RowDataPacket[]>(`SELECT id, entidad_id, monto_total, moneda, estado_admin, retencion_iva_pct, retencion_iva_monto FROM fact_facturas WHERE empresa_id=? AND id=? FOR UPDATE`, [empresaId, facturaId]);
  if (!rows[0]) throw new ErrorConfirmacionBancaria("Factura no encontrada.", 404);
  return rows[0];
}
function bloqueo(f: RowDataPacket) {
  return motivoBloqueoBancario({ moneda: String(f.moneda), retencionPct: String(f.retencion_iva_pct ?? "0"), retencionMonto: String(f.retencion_iva_monto ?? "0"), estado: String(f.estado_admin), entidadId: f.entidad_id == null ? null : Number(f.entidad_id) });
}
async function totalActivo(c: PoolConnection, empresaId: number, entidadId: number, facturaId: number) {
  const [r] = await c.query<RowDataPacket[]>("SELECT COALESCE(SUM(monto),0) AS total FROM fact_pago_confirmaciones WHERE empresa_id=? AND entidad_id=? AND factura_id=? AND estado='CONFIRMADA'", [empresaId, entidadId, facturaId]);
  return new Decimal(String(r[0].total));
}
export async function confirmarIngresoBancario(actor: ActorBancario, facturaId: number, raw: z.input<typeof confirmacionBancariaSchema>, evidencia: EvidenciaBancaria | null = null) {
  const input = confirmacionBancariaSchema.parse(raw);
  return transaccion(async (c) => {
    const f = await facturaBloqueada(c, actor.empresaId, facturaId);
    const entidadId = Number(f.entidad_id);
    const huella = huellaConfirmacion(actor.empresaId, entidadId, facturaId, input, evidencia);
    const [prev] = await c.query<RowDataPacket[]>("SELECT id, huella, estado FROM fact_pago_confirmaciones WHERE empresa_id=? AND entidad_id=? AND idempotency_key=? FOR UPDATE", [actor.empresaId, entidadId, input.idempotencyKey]);
    if (prev[0]) {
      if (prev[0].huella !== huella) throw new ErrorConfirmacionBancaria("La clave de idempotencia ya fue usada con datos diferentes.");
      return { id: Number(prev[0].id), estado: String(prev[0].estado), idempotente: true };
    }
    const motivo = bloqueo(f); if (motivo) throw new ErrorConfirmacionBancaria(motivo);
    // Cuenta, entidad y cuenta contable se revalidan bajo lock, no desde el catálogo del navegador.
    const [cuentas] = await c.query<RowDataPacket[]>(`SELECT b.id, b.moneda FROM cont_cuentas_bancarias b
      JOIN cont_entidades e ON e.empresa_id=b.empresa_id AND e.id=b.entidad_id
      JOIN cont_cuentas cc ON cc.empresa_id=b.empresa_id AND cc.entidad_id=b.entidad_id AND cc.id=b.cuenta_id
      WHERE b.id=? AND b.empresa_id=? AND b.entidad_id=? AND b.activa=1 AND e.activa=1 AND cc.activa=1 FOR UPDATE`, [input.cuentaBancariaId, actor.empresaId, entidadId]);
    if (!cuentas[0]) throw new ErrorConfirmacionBancaria("Cuenta bancaria no disponible para esta empresa y entidad.");
    if (cuentas[0].moneda !== "GTQ") throw new ErrorConfirmacionBancaria(BLOQUEO_MONEDA);
    if (input.pagoId !== null) {
      const [pagos] = await c.query<RowDataPacket[]>("SELECT id FROM fact_pagos WHERE id=? AND empresa_id=? AND factura_id=? FOR UPDATE", [input.pagoId, actor.empresaId, facturaId]);
      if (!pagos[0]) throw new ErrorConfirmacionBancaria("El pago informado no pertenece a esta factura y empresa.");
    }
    if (input.cobroId !== null) {
      // Se bloquea la fila del cobro (todas las confirmaciones vinculadas pasan por aquí, serializadas) y se lee lo aplicado por ESE cobro a ESTA factura.
      const [cobros] = await c.query<RowDataPacket[]>(
        `SELECT c.id, a.monto AS aplicado FROM fact_cobros c JOIN fact_cobro_aplicaciones a ON a.cobro_id = c.id AND a.factura_id = ?
          WHERE c.id = ? AND c.empresa_id = ? AND c.entidad_id = ? AND c.estado = 'VIGENTE' FOR UPDATE`, [facturaId, input.cobroId, actor.empresaId, entidadId]);
      if (!cobros[0]) throw new ErrorConfirmacionBancaria("El cobro informado no está vigente o no incluye esta factura.");
      // SUM(confirmaciones CONFIRMADAS de este cobro y factura) + nuevo monto <= monto aplicado por el cobro a la factura. Las ANULADAS no cuentan.
      const [vinc] = await c.query<RowDataPacket[]>(
        "SELECT COALESCE(SUM(monto),0) AS total FROM fact_pago_confirmaciones WHERE empresa_id=? AND entidad_id=? AND cobro_id=? AND factura_id=? AND estado='CONFIRMADA'",
        [actor.empresaId, entidadId, input.cobroId, facturaId]);
      const aplicado = new Decimal(String(cobros[0].aplicado)), yaVinculado = new Decimal(String(vinc[0].total));
      if (yaVinculado.plus(input.monto).gt(aplicado)) {
        throw new ErrorConfirmacionBancaria(`El monto excede lo aplicado por el cobro a esta factura (Q${aplicado.toFixed(2)}; ya confirmado Q${yaVinculado.toFixed(2)}).`);
      }
    }
    const total = await totalActivo(c, actor.empresaId, entidadId, facturaId);
    if (total.plus(input.monto).gt(String(f.monto_total))) throw new ErrorConfirmacionBancaria("El monto excede el saldo pendiente de confirmación bancaria.");
    const [r] = await c.execute<ResultSetHeader>(`INSERT INTO fact_pago_confirmaciones
      (empresa_id,entidad_id,pago_id,factura_id,cuenta_bancaria_id,monto,fecha_acreditacion,referencia,observaciones,idempotency_key,huella,confirmado_por,evidencia_ruta,evidencia_nombre,evidencia_mime,evidencia_tamano,evidencia_sha256)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [actor.empresaId, entidadId, input.pagoId, facturaId, input.cuentaBancariaId, new Decimal(input.monto).toFixed(2), input.fechaAcreditacion, input.referencia, input.observaciones, input.idempotencyKey, huella, actor.usuarioId, evidencia?.ruta ?? null, evidencia?.nombre ?? null, evidencia?.mime ?? null, evidencia?.tamano ?? null, evidencia?.sha256 ?? null]);
    // CxC-1: vínculo con el cobro multi-factura (columna agregada por la migración CxC-1; solo se toca cuando hay cobro).
    if (input.cobroId !== null) await c.execute("UPDATE fact_pago_confirmaciones SET cobro_id=? WHERE id=? AND empresa_id=?", [input.cobroId, r.insertId, actor.empresaId]);
    await registrarBitacoraFactura(c, actor, "confirmar_ingreso_bancario", `Factura #${facturaId} · confirmación #${r.insertId} · Q${new Decimal(input.monto).toFixed(2)}`, { facturaId, entidadId, monto: new Decimal(input.monto).toFixed(2), referencia: input.referencia });
    return { id: r.insertId, estado: "CONFIRMADA", idempotente: false };
  });
}
export async function anularConfirmacionBancaria(actor: ActorBancario, facturaId: number, id: number, motivo: string) {
  if (!motivo.trim() || motivo.trim().length > 2000) throw new ErrorConfirmacionBancaria("Motivo de anulación obligatorio.", 400);
  return transaccion(async (c) => {
    await facturaBloqueada(c, actor.empresaId, facturaId);
    const [r] = await c.query<RowDataPacket[]>("SELECT id, estado FROM fact_pago_confirmaciones WHERE empresa_id=? AND factura_id=? AND id=? FOR UPDATE", [actor.empresaId, facturaId, id]);
    if (!r[0]) throw new ErrorConfirmacionBancaria("Confirmación no encontrada.", 404);
    if (r[0].estado === "ANULADA") return { id, idempotente: true };
    await c.execute("UPDATE fact_pago_confirmaciones SET estado='ANULADA', anulado_por=?, anulado_en=CURRENT_TIMESTAMP, motivo_anulacion=? WHERE id=? AND empresa_id=? AND estado='CONFIRMADA'", [actor.usuarioId, motivo.trim(), id, actor.empresaId]);
    await registrarBitacoraFactura(c, actor, "anular_confirmacion_bancaria", `Factura #${facturaId} · confirmación #${id} · ${motivo.trim()}`, { facturaId, motivo: motivo.trim() });
    return { id, idempotente: false };
  });
}
export async function listarConfirmacionesBancarias(empresaId: number, facturaId: number) {
  // Lectura coherente del agregado con el mismo lock que escritura; no registra auditoría ni altera saldos.
  return transaccion(async (c) => {
    const f = await facturaBloqueada(c, empresaId, facturaId);
    const [confirmaciones] = await c.query<HistorialBancario[]>(`SELECT p.id,p.pago_id,p.monto,DATE_FORMAT(p.fecha_acreditacion,'%Y-%m-%d') AS fecha_acreditacion,p.referencia,p.observaciones,p.estado,p.confirmado_por,u.username AS confirmado_nombre,p.confirmado_en,p.anulado_en,p.motivo_anulacion,
      b.banco,b.alias,(p.evidencia_ruta IS NOT NULL) AS tiene_evidencia
      FROM fact_pago_confirmaciones p JOIN cont_cuentas_bancarias b ON b.empresa_id=p.empresa_id AND b.entidad_id=p.entidad_id AND b.id=p.cuenta_bancaria_id
      LEFT JOIN usuarios u ON u.id=p.confirmado_por WHERE p.empresa_id=? AND p.factura_id=? ORDER BY p.id DESC`, [empresaId, facturaId]);
    const [cuentas] = await c.query<RowDataPacket[]>(`SELECT b.id,b.banco,b.alias FROM cont_cuentas_bancarias b JOIN cont_entidades e ON e.empresa_id=b.empresa_id AND e.id=b.entidad_id JOIN cont_cuentas cc ON cc.empresa_id=b.empresa_id AND cc.entidad_id=b.entidad_id AND cc.id=b.cuenta_id WHERE b.empresa_id=? AND b.entidad_id=? AND b.activa=1 AND e.activa=1 AND cc.activa=1 AND b.moneda='GTQ' ORDER BY b.alias`, [empresaId, f.entidad_id]);
    const [pagos] = await c.query<RowDataPacket[]>("SELECT id, CAST(monto AS CHAR) AS monto, referencia FROM fact_pagos WHERE empresa_id=? AND factura_id=? ORDER BY id", [empresaId, facturaId]);
    // CxC-1: cobros multi-factura vigentes que incluyen esta factura (vínculo opcional de la confirmación). Tolera la migración pendiente.
    let cobros: RowDataPacket[] = [];
    if (f.entidad_id != null) {
      try {
        [cobros] = await c.query<RowDataPacket[]>(
          `SELECT k.id, CAST(a.monto AS CHAR) AS monto, k.referencia FROM fact_cobros k JOIN fact_cobro_aplicaciones a ON a.cobro_id = k.id AND a.factura_id = ?
            WHERE k.empresa_id = ? AND k.entidad_id = ? AND k.estado = 'VIGENTE' ORDER BY k.id`, [facturaId, empresaId, Number(f.entidad_id)]);
      } catch (e) { if ((e as { code?: string })?.code !== "ER_NO_SUCH_TABLE") throw e; }
    }
    const total = f.entidad_id == null ? new Decimal(0) : await totalActivo(c, empresaId, Number(f.entidad_id), facturaId);
    const motivo = bloqueo(f);
    return { confirmaciones: confirmaciones.map((r) => ({ ...r, monto: new Decimal(String(r.monto)).toFixed(2) })), cuentas: motivo ? [] : cuentas, pagos,
      cobros, totalConfirmadoActivo: total.toFixed(2), saldoPendiente: motivo ? null : new Decimal(String(f.monto_total)).minus(total).toFixed(2), bloqueo: motivo };
  });
}
export async function evidenciaConfirmacionBancaria(empresaId: number, facturaId: number, id: number) {
  const c = await getPool().getConnection();
  try {
    const [r] = await c.query<RowDataPacket[]>("SELECT p.evidencia_ruta,p.evidencia_mime,p.evidencia_sha256 FROM fact_pago_confirmaciones p JOIN fact_facturas f ON f.id=p.factura_id AND f.empresa_id=p.empresa_id AND f.entidad_id=p.entidad_id WHERE p.empresa_id=? AND p.factura_id=? AND p.id=?", [empresaId, facturaId, id]);
    if (!r[0]?.evidencia_ruta) throw new ErrorConfirmacionBancaria("Evidencia no encontrada.", 404);
    return r[0];
  } finally { c.release(); }
}
