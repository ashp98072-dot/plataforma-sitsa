import Decimal from "decimal.js";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { getPool, query } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import { ErrorCxp, esConflictoTransitorio, esErrorDuplicado } from "./errores";
import { obtenerAplicado } from "./aplicaciones";
import { calcularIsrProveedor, type RegimenFiscal, type ResultadoIsr, type TramoIsr } from "./isr-proveedor";
import { desgloseFinanciero, type EstadoAdminCxp, type EstadoFinancieroCxp } from "./saldo";
import { documentoNormalizado, fechaIso, idPositivo, importe, textoOpcional } from "./validacion";

/**
 * M-3A/M-3B1 — Facturas de proveedor (CxP). Modelo propio (`cxp_facturas`); `cont_cxp` queda como histórico y `fact_facturas`/`fact_pagos` (clientes) no se tocan.
 * Todo cálculo (total, ISR, neto a pagar) lo hace el SERVIDOR; del cliente solo se aceptan los datos capturados del documento.
 */
export type Actor = { id: number; username: string };
export type EntradaFactura = {
  proveedorId?: unknown; tipoDocumento?: unknown; serie?: unknown; numero?: unknown; fechaDocumento?: unknown; fechaVencimiento?: unknown;
  baseNeto?: unknown; ivaMonto?: unknown; observaciones?: unknown;
};
export type Calculo = {
  baseNeto: string; ivaMonto: string; totalDocumento: string; isrPorcentaje: string; isrMonto: string; totalNetoPagar: string;
  /** Desglose del ISR (la tasa es la MARGINAL del tramo): parte fija + parte variable = isrMonto. */
  isrTramo: TramoIsr; isrFijo: string; isrVariable: string;
  reglaIsr: string; regimenFiscal: RegimenFiscal; sujetoIsr: boolean; advertencias: string[];
};
export type FacturaCxp = {
  id: number; empresaId: number; entidadId: number; proveedorId: number; proveedorNombre: string; tipoDocumento: string; serie: string; numero: string;
  fechaDocumento: string; fechaVencimiento: string | null; baseNeto: string; ivaMonto: string; totalDocumento: string; isrPorcentaje: string; isrMonto: string;
  totalNetoPagar: string; reglaIsr: string; regimenFiscal: string; sujetoIsr: boolean; observaciones: string | null; estadoAdmin: EstadoAdminCxp;
  creadoPor: number; creadoEn: string; anuladoPor: number | null; anuladoEn: string | null; motivoAnulacion: string | null;
  /**
   * Situación financiera DERIVADA (nunca columna): retención = isrMonto (se resta del total, NO es un pago), montoPagadero = total − retención,
   * pagado = pagos REGISTRADOS aplicados, saldo = montoPagadero − pagado.
   */
  retencionIsr: string; montoPagadero: string; pagado: string; saldo: string; estadoFinanciero: EstadoFinancieroCxp;
};

const TASA_IVA_REFERENCIA = "0.12";

/** Retorna el cálculo fiscal de una factura SIN persistir (ISR con redondeo confirmado a 2 decimales, mitad hacia arriba). */
export function calcularFactura(baseNeto: string, ivaMonto: string, regimenFiscal: RegimenFiscal, sujetoIsr: boolean): Calculo {
  const isr: ResultadoIsr = calcularIsrProveedor({ baseNeto, regimenFiscal, sujetoIsr });
  const total = new Decimal(baseNeto).plus(ivaMonto);
  const advertencias: string[] = [];
  if (!new Decimal(ivaMonto).eq(new Decimal(baseNeto).times(TASA_IVA_REFERENCIA).toDecimalPlaces(2, Decimal.ROUND_HALF_UP))) {
    advertencias.push("El IVA capturado no es el 12 % de la base neta. Verifica el documento (puede ser correcto si hay exentos o régimen especial).");
  }
  return {
    baseNeto, ivaMonto, totalDocumento: total.toFixed(2), isrPorcentaje: isr.porcentaje, isrMonto: isr.monto,
    totalNetoPagar: total.minus(isr.monto).toFixed(2), isrTramo: isr.tramo, isrFijo: isr.fijo, isrVariable: isr.variable,
    reglaIsr: isr.regla, regimenFiscal, sujetoIsr, advertencias,
  };
}

type Validada = {
  proveedorId: number; serie: string; numero: string; serieNorm: string; numeroNorm: string; fechaDocumento: string; fechaVencimiento: string | null;
  baseNeto: string; ivaMonto: string; observaciones: string | null;
};
function validar(e: EntradaFactura): Validada {
  const proveedorId = idPositivo(e.proveedorId, "Proveedor");
  if (e.tipoDocumento !== undefined && e.tipoDocumento !== "FACTURA") {
    if (e.tipoDocumento === "FACTURA_ESPECIAL") {
      throw new ErrorCxp("La factura especial (IVA e ISR sobre la base del pago) está pendiente de reglas de Contabilidad y aún no se puede registrar.", 422, "FACTURA_ESPECIAL_PENDIENTE");
    }
    throw new ErrorCxp("Tipo de documento inválido.", 400, "TIPO_INVALIDO");
  }
  const doc = documentoNormalizado(e.serie, e.numero);
  const fechaDocumento = fechaIso(e.fechaDocumento, "Fecha del documento");
  const fechaVencimiento = e.fechaVencimiento == null || e.fechaVencimiento === "" ? null : fechaIso(e.fechaVencimiento, "Fecha de vencimiento");
  if (fechaVencimiento && fechaVencimiento < fechaDocumento) throw new ErrorCxp("El vencimiento no puede ser anterior a la fecha del documento.", 400, "VENCIMIENTO_INVALIDO");
  const obs = textoOpcional(e.observaciones, 500, "Observaciones");
  return {
    proveedorId, ...doc, fechaDocumento, fechaVencimiento, baseNeto: importe(e.baseNeto, "Base neta"),
    ivaMonto: importe(e.ivaMonto ?? "0", "IVA", { permitirCero: true }), observaciones: obs || null,
  };
}

type Conexion = Pick<PoolConnection, "query">;
async function cargarConfigProveedor(c: Conexion, empresaId: number, entidadId: number, proveedorId: number, bloqueo: "" | " LOCK IN SHARE MODE") {
  const [rows] = await c.query<RowDataPacket[]>(
    `SELECT f.regimen_fiscal, f.sujeto_isr, f.activo AS config_activa, p.activo AS proveedor_activo, p.nombre_comercial
       FROM cxp_proveedor_fiscal f JOIN compras_proveedores p ON p.empresa_id = f.empresa_id AND p.id = f.proveedor_id
      WHERE f.empresa_id = ? AND f.entidad_id = ? AND f.proveedor_id = ?${bloqueo}`, [empresaId, entidadId, proveedorId]);
  const r = rows[0];
  if (!r) throw new ErrorCxp("El proveedor no tiene configuración fiscal para esta entidad. Configúralo antes de registrar facturas.", 409, "PROVEEDOR_SIN_CONFIG_FISCAL");
  if (Number(r.config_activa) !== 1) throw new ErrorCxp("La configuración fiscal del proveedor está inactiva.", 409, "CONFIG_INACTIVA");
  if (Number(r.proveedor_activo) !== 1) throw new ErrorCxp("El proveedor está inactivo.", 409, "PROVEEDOR_INACTIVO");
  return { regimenFiscal: String(r.regimen_fiscal) as RegimenFiscal, sujetoIsr: Number(r.sujeto_isr) === 1, nombre: String(r.nombre_comercial) };
}

/** Cálculo sin guardar (para mostrar al usuario ISR, neto a pagar y advertencias antes de registrar). */
export async function previsualizarFactura(empresaId: number, entidadId: number, entrada: EntradaFactura): Promise<Calculo & { proveedorNombre: string }> {
  const v = validar(entrada);
  const cfg = await cargarConfigProveedor({ query: (s: string, p?: unknown[]) => getPool().query(s, p) } as Conexion, empresaId, entidadId, v.proveedorId, "");
  return { ...calcularFactura(v.baseNeto, v.ivaMonto, cfg.regimenFiscal, cfg.sujetoIsr), proveedorNombre: cfg.nombre };
}

const SELECT = `SELECT x.id, x.empresa_id, x.entidad_id, x.proveedor_id, p.nombre_comercial, x.tipo_documento, x.serie, x.numero,
  DATE_FORMAT(x.fecha_documento,'%Y-%m-%d') AS fecha_documento, DATE_FORMAT(x.fecha_vencimiento,'%Y-%m-%d') AS fecha_vencimiento,
  x.base_neto, x.iva_monto, x.total_documento, x.isr_porcentaje, x.isr_monto, x.total_neto_pagar, x.regla_isr, x.regimen_fiscal_snapshot, x.sujeto_isr_snapshot,
  x.observaciones, x.estado_admin, x.creado_por, DATE_FORMAT(x.creado_en,'%Y-%m-%d %H:%i:%s') AS creado_en, x.anulado_por,
  DATE_FORMAT(x.anulado_en,'%Y-%m-%d %H:%i:%s') AS anulado_en, x.motivo_anulacion
  FROM cxp_facturas x JOIN compras_proveedores p ON p.empresa_id = x.empresa_id AND p.id = x.proveedor_id`;

function mapear(r: RowDataPacket, aplicado = "0.00"): FacturaCxp {
  const estadoAdmin = String(r.estado_admin) as EstadoAdminCxp;
  const totalNetoPagar = new Decimal(String(r.total_neto_pagar)).toFixed(2);
  const fin = desgloseFinanciero(estadoAdmin, { totalDocumento: String(r.total_documento), isrMonto: String(r.isr_monto), totalNetoPagar }, aplicado);
  return {
    id: Number(r.id), empresaId: Number(r.empresa_id), entidadId: Number(r.entidad_id), proveedorId: Number(r.proveedor_id), proveedorNombre: String(r.nombre_comercial),
    tipoDocumento: String(r.tipo_documento), serie: String(r.serie), numero: String(r.numero), fechaDocumento: String(r.fecha_documento),
    fechaVencimiento: r.fecha_vencimiento == null ? null : String(r.fecha_vencimiento),
    baseNeto: String(r.base_neto), ivaMonto: String(r.iva_monto), totalDocumento: String(r.total_documento), isrPorcentaje: String(r.isr_porcentaje),
    isrMonto: String(r.isr_monto), totalNetoPagar, reglaIsr: String(r.regla_isr), regimenFiscal: String(r.regimen_fiscal_snapshot),
    sujetoIsr: Number(r.sujeto_isr_snapshot) === 1, observaciones: r.observaciones == null ? null : String(r.observaciones), estadoAdmin,
    creadoPor: Number(r.creado_por), creadoEn: String(r.creado_en), anuladoPor: r.anulado_por == null ? null : Number(r.anulado_por),
    anuladoEn: r.anulado_en == null ? null : String(r.anulado_en), motivoAnulacion: r.motivo_anulacion == null ? null : String(r.motivo_anulacion),
    retencionIsr: fin.retencionIsr, montoPagadero: fin.montoPagadero, pagado: fin.pagado, saldo: fin.saldo, estadoFinanciero: fin.estadoFinanciero,
  };
}

export async function registrarFactura(empresaId: number, entidadId: number, actor: Actor, entrada: EntradaFactura): Promise<{ factura: FacturaCxp; advertencias: string[] }> {
  const v = validar(entrada);
  const conn = await getPool().getConnection();
  try {
    await conn.query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED");
    await conn.beginTransaction();
    const [entidad] = await conn.query<RowDataPacket[]>("SELECT activa FROM cont_entidades WHERE empresa_id = ? AND id = ? LOCK IN SHARE MODE", [empresaId, entidadId]);
    if (!entidad[0] || Number(entidad[0].activa) !== 1) throw new ErrorCxp("Entidad no disponible.", 404, "ENTIDAD_NO_DISPONIBLE");
    // La configuración se lee con LOCK IN SHARE MODE: no puede cambiar a mitad del registro (el cálculo usa SU valor, no el del cliente).
    const cfg = await cargarConfigProveedor(conn, empresaId, entidadId, v.proveedorId, " LOCK IN SHARE MODE");
    const calculo = calcularFactura(v.baseNeto, v.ivaMonto, cfg.regimenFiscal, cfg.sujetoIsr);

    const [dup] = await conn.query<RowDataPacket[]>(
      `SELECT id, estado_admin, DATE_FORMAT(fecha_documento,'%Y-%m-%d') AS fecha FROM cxp_facturas
        WHERE empresa_id = ? AND proveedor_id = ? AND serie_norm = ? AND numero_norm = ? ORDER BY id LIMIT 1`,
      [empresaId, v.proveedorId, v.serieNorm, v.numeroNorm]);
    if (dup[0]) throw errorDuplicado(v, cfg.nombre, Number(dup[0].id), String(dup[0].fecha), String(dup[0].estado_admin) === "ANULADA");

    let id: number;
    try {
      const [r] = await conn.execute<import("mysql2/promise").ResultSetHeader>(
        `INSERT INTO cxp_facturas (empresa_id, entidad_id, proveedor_id, tipo_documento, serie, numero, serie_norm, numero_norm, fecha_documento, fecha_vencimiento,
           base_neto, iva_monto, total_documento, isr_porcentaje, isr_monto, total_neto_pagar, regla_isr, regimen_fiscal_snapshot, sujeto_isr_snapshot, observaciones, creado_por)
         VALUES (?, ?, ?, 'FACTURA', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [empresaId, entidadId, v.proveedorId, v.serie, v.numero, v.serieNorm, v.numeroNorm, v.fechaDocumento, v.fechaVencimiento,
          calculo.baseNeto, calculo.ivaMonto, calculo.totalDocumento, calculo.isrPorcentaje, calculo.isrMonto, calculo.totalNetoPagar, calculo.reglaIsr,
          calculo.regimenFiscal, calculo.sujetoIsr ? 1 : 0, v.observaciones, actor.id]);
      id = Number(r.insertId);
    } catch (e) {
      if (esErrorDuplicado(e)) throw errorDuplicado(v, cfg.nombre, null, null, false);
      throw e;
    }
    await registrarAuditoriaTx(conn, {
      empresaId, usuario: actor.username, modulo: "contabilidad", accion: "cxp_registrar_factura",
      detalle: JSON.stringify({ entidadId, facturaId: id, proveedorId: v.proveedorId, usuarioId: actor.id, documento: `${v.serie ? `${v.serie}-` : ""}${v.numero}`,
        baseNeto: calculo.baseNeto, iva: calculo.ivaMonto, total: calculo.totalDocumento, isr: calculo.isrMonto, neto: calculo.totalNetoPagar, regla: calculo.reglaIsr }),
    });
    await conn.commit();
    const factura = (await obtenerFactura(empresaId, entidadId, id))!;
    return { factura, advertencias: calculo.advertencias };
  } catch (e) {
    try { await conn.rollback(); } catch { /* conserva el error original */ }
    if (esConflictoTransitorio(e)) throw new ErrorCxp("Operación en conflicto. Actualiza y vuelve a intentar.", 409, "CONFLICTO");
    throw e;
  } finally { conn.release(); }
}

/**
 * El documento (empresa + proveedor + serie + número) queda reservado EN TODOS LOS ESTADOS: una factura anulada NO libera su serie+número
 * (regla CONFIRMADA por Contabilidad en M-3B1; antes era provisional). Cambiar esta regla exigiría relajar el UNIQUE `uq_cxpf_documento`.
 */
function errorDuplicado(v: Validada, proveedor: string, existenteId: number | null, fecha: string | null, anulada: boolean) {
  const doc = `${v.serie ? `${v.serie} / ` : ""}${v.numero}`;
  const donde = existenteId ? ` (CxP #${existenteId}${fecha ? `, fecha ${fecha}` : ""})` : "";
  const nota = anulada ? " Está ANULADA y una factura anulada no libera su serie y número; consulta con Contabilidad cómo corregirla." : "";
  return new ErrorCxp(`La factura ${doc} del proveedor ${proveedor} ya existe${donde}.${nota}`, 409, "FACTURA_DUPLICADA");
}

export async function obtenerFactura(empresaId: number, entidadId: number, id: number): Promise<FacturaCxp | null> {
  const rows = await query<RowDataPacket[]>(`${SELECT} WHERE x.empresa_id = ? AND x.entidad_id = ? AND x.id = ?`, [empresaId, entidadId, id]);
  if (!rows[0]) return null;
  return mapear(rows[0], (await obtenerAplicado(empresaId, entidadId, [id], undefined, { tolerarSinMigracion: true })).get(id));
}

export type FiltrosFacturas = { proveedorId?: number; estado?: EstadoAdminCxp; desde?: string; hasta?: string; q?: string; page?: number; pageSize?: number };
export async function listarFacturas(empresaId: number, entidadId: number, f: FiltrosFacturas = {}) {
  const pageSize = Math.min(Math.max(f.pageSize ?? 25, 1), 100), page = Math.max(f.page ?? 1, 1);
  const w = ["x.empresa_id = ?", "x.entidad_id = ?"]; const p: (string | number)[] = [empresaId, entidadId];
  if (f.proveedorId) { w.push("x.proveedor_id = ?"); p.push(f.proveedorId); }
  if (f.estado) { w.push("x.estado_admin = ?"); p.push(f.estado); }
  if (f.desde) { w.push("x.fecha_documento >= ?"); p.push(f.desde); }
  if (f.hasta) { w.push("x.fecha_documento <= ?"); p.push(f.hasta); }
  if (f.q?.trim()) { w.push("(LOCATE(?, x.numero) > 0 OR LOCATE(?, x.serie) > 0 OR LOCATE(?, p.nombre_comercial) > 0)"); const t = f.q.trim().slice(0, 100); p.push(t, t, t); }
  const desde = `FROM cxp_facturas x JOIN compras_proveedores p ON p.empresa_id = x.empresa_id AND p.id = x.proveedor_id WHERE ${w.join(" AND ")}`;
  const [tot] = await query<RowDataPacket[]>(`SELECT COUNT(*) AS n ${desde}`, p);
  const rows = await query<RowDataPacket[]>(`${SELECT} WHERE ${w.join(" AND ")} ORDER BY x.fecha_documento DESC, x.id DESC LIMIT ? OFFSET ?`, [...p, pageSize, (page - 1) * pageSize]);
  const aplicado = await obtenerAplicado(empresaId, entidadId, rows.map(r => Number(r.id)), undefined, { tolerarSinMigracion: true });
  return { total: Number(tot?.n ?? 0), page, pageSize, facturas: rows.map(r => mapear(r, aplicado.get(Number(r.id)))) };
}

/** Anulación con motivo. Sin borrados: la fila queda (ANULADA) y su clave de documento sigue reservada (confirmado). Se rechaza si tiene pagos aplicados vigentes: primero se reversan. */
export async function anularFactura(empresaId: number, entidadId: number, id: unknown, actor: Actor, motivoEntrada: unknown): Promise<FacturaCxp> {
  const facturaId = idPositivo(id, "Factura");
  const motivo = textoOpcional(motivoEntrada, 500, "Motivo");
  if (motivo.length < 3) throw new ErrorCxp("Indica el motivo de la anulación (mínimo 3 caracteres).", 400, "MOTIVO_REQUERIDO");
  const conn = await getPool().getConnection();
  try {
    await conn.query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED");
    await conn.beginTransaction();
    const [rows] = await conn.query<RowDataPacket[]>("SELECT id, estado_admin FROM cxp_facturas WHERE empresa_id = ? AND entidad_id = ? AND id = ? FOR UPDATE", [empresaId, entidadId, facturaId]);
    if (!rows[0]) throw new ErrorCxp("Factura no encontrada.", 404, "NO_ENCONTRADA");
    if (String(rows[0].estado_admin) === "ANULADA") throw new ErrorCxp("La factura ya está anulada.", 409, "YA_ANULADA");
    // La factura ya está bloqueada (FOR UPDATE): un pago concurrente espera su bloqueo, así que este pagado es definitivo. Pagos REVERSADOS no cuentan.
    const aplicado = (await obtenerAplicado(empresaId, entidadId, [facturaId], conn, { tolerarSinMigracion: true })).get(facturaId) ?? "0.00";
    if (!new Decimal(aplicado).isZero()) throw new ErrorCxp("La factura tiene pagos aplicados: reversa los pagos antes de anularla.", 409, "TIENE_PAGOS");
    await conn.execute("UPDATE cxp_facturas SET estado_admin = 'ANULADA', anulado_por = ?, anulado_en = NOW(), motivo_anulacion = ? WHERE empresa_id = ? AND entidad_id = ? AND id = ?",
      [actor.id, motivo, empresaId, entidadId, facturaId]);
    await registrarAuditoriaTx(conn, {
      empresaId, usuario: actor.username, modulo: "contabilidad", accion: "cxp_anular_factura",
      detalle: JSON.stringify({ entidadId, facturaId, usuarioId: actor.id, motivo, antes: "REGISTRADA", despues: "ANULADA" }),
    });
    await conn.commit();
  } catch (e) {
    try { await conn.rollback(); } catch { /* conserva el error original */ }
    if (esConflictoTransitorio(e)) throw new ErrorCxp("Operación en conflicto. Actualiza y vuelve a intentar.", 409, "CONFLICTO");
    throw e;
  } finally { conn.release(); }
  return (await obtenerFactura(empresaId, entidadId, facturaId))!;
}
