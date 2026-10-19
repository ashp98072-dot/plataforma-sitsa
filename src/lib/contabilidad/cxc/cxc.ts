import type { RowDataPacket } from "mysql2/promise";
import { query } from "@/lib/db";
import { AccesoContable } from "@/lib/contabilidad/ambito";
import { listarCuentasPorCobrar } from "@/lib/facturacion/cuentas-por-cobrar";
import { importe, paginacionEfectiva, type FiltrosCxc, type RespuestaListaCxc } from "@/lib/facturacion/cuentas-por-cobrar-shared";
import { registrarPago } from "@/lib/facturacion/facturas";

/**
 * Contabilidad → Cuentas por cobrar. Es una VISTA sobre la CxC oficial de la plataforma (fact_facturas + fact_pagos, lógica de
 * `lib/facturacion/cuentas-por-cobrar.ts` y `registrarPago` de Facturación). NO usa `cont_cxc` (registro manual legado) ni agrega reglas:
 * saldo = monto_total − Σ pagos, estados Emitida/Anulada, protección de sobrepago y auditoría son los de Facturación.
 * Todo se acota SIEMPRE por (empresa de la sesión, entidad/libro seleccionado): la entidad nunca queda "todas" ni se toma de otro lado.
 */

export type ActorCxc = { empresaId: number; usuarioId: number; usuario: string };

/** La entidad debe existir, ser de la empresa y estar activa (mismo criterio que el resto de Contabilidad). */
export async function exigirEntidadActiva(empresaId: number, entidadId: number): Promise<void> {
  const rows = await query<RowDataPacket[]>("SELECT activa FROM cont_entidades WHERE empresa_id = ? AND id = ? LIMIT 1", [empresaId, entidadId]);
  if (!rows[0] || Number(rows[0].activa) !== 1) throw new AccesoContable("Entidad no disponible.", 404);
}

/** Documentos de CxC (facturas Emitidas y Anuladas) de UN libro. El filtro de entidad del cliente HTTP se ignora: manda `entidadId`. */
export async function listarDocumentosCxc(empresaId: number, entidadId: number, filtros: FiltrosCxc): Promise<RespuestaListaCxc> {
  await exigirEntidadActiva(empresaId, entidadId);
  return listarCuentasPorCobrar(empresaId, { ...filtros, vista: "historial", entidad: entidadId });
}

export type CobroCxc = {
  id: number; facturaId: number; numeroFactura: string | null; clienteId: number; cliente: string; fechaPago: string; monto: string;
  medioPago: string | null; referencia: string | null; observaciones: string | null; estadoFactura: string;
};
export type FiltrosCobros = { clienteId?: number; textoCliente?: string; numeroFactura?: string; fechaDesde?: string; fechaHasta?: string; page?: number; pageSize?: number };

const escaparLike = (t: string) => t.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Cobros reales (fact_pagos) de las facturas de UN libro, más recientes primero. Solo lectura. */
export async function listarCobrosCxc(empresaId: number, entidadId: number, f: FiltrosCobros = {}) {
  await exigirEntidadActiva(empresaId, entidadId);
  const { page, pageSize, offset } = paginacionEfectiva(f);
  const w = ["p.empresa_id = ?", "f.empresa_id = p.empresa_id", "f.entidad_id = ?"];
  const params: (string | number)[] = [empresaId, entidadId];
  if (f.clienteId) { w.push("f.cliente_id = ?"); params.push(f.clienteId); }
  if (f.fechaDesde) { w.push("p.fecha_pago >= ?"); params.push(f.fechaDesde); }
  if (f.fechaHasta) { w.push("p.fecha_pago <= ?"); params.push(f.fechaHasta); }
  if (f.numeroFactura) { w.push("f.numero_factura LIKE ? ESCAPE '\\\\'"); params.push(`%${escaparLike(f.numeroFactura)}%`); }
  if (f.textoCliente) {
    const t = `%${escaparLike(f.textoCliente)}%`;
    w.push("(f.cliente_nombre_snapshot LIKE ? ESCAPE '\\\\' OR c.nombre LIKE ? ESCAPE '\\\\' OR c.razon_social LIKE ? ESCAPE '\\\\')");
    params.push(t, t, t);
  }
  const desde = `FROM fact_pagos p JOIN fact_facturas f ON f.id = p.factura_id
     INNER JOIN clientes c ON c.id = f.cliente_id AND c.empresa_id = f.empresa_id WHERE ${w.join(" AND ")}`;
  const [tot] = await query<RowDataPacket[]>(`SELECT COUNT(*) AS n, COALESCE(SUM(p.monto), 0) AS suma ${desde}`, params);
  const rows = await query<RowDataPacket[]>(
    `SELECT p.id, p.factura_id, f.numero_factura, f.cliente_id, COALESCE(f.cliente_nombre_snapshot, c.nombre) AS cliente,
            DATE_FORMAT(p.fecha_pago, '%Y-%m-%d') AS fecha_pago, p.monto, p.medio_pago, p.referencia, p.observaciones, f.estado_admin
       ${desde} ORDER BY p.fecha_pago DESC, p.id DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]);
  const cobros: CobroCxc[] = rows.map((r) => ({
    id: Number(r.id), facturaId: Number(r.factura_id), numeroFactura: r.numero_factura != null ? String(r.numero_factura) : null, clienteId: Number(r.cliente_id),
    cliente: String(r.cliente), fechaPago: String(r.fecha_pago), monto: importe(r.monto), medioPago: r.medio_pago != null ? String(r.medio_pago) : null,
    referencia: r.referencia != null && String(r.referencia).trim() ? String(r.referencia) : null,
    observaciones: r.observaciones != null && String(r.observaciones).trim() ? String(r.observaciones) : null, estadoFactura: String(r.estado_admin),
  }));
  return { cobros, totalReal: Number(tot?.n ?? 0), totalCobrado: importe(tot?.suma), page, pageSize };
}

export type EntradaCobro = { facturaId: number; fechaPago: string; monto: number; referencia?: string | null; medioPago?: string | null; observaciones?: string | null };

/**
 * Registra un cobro con EL MISMO servicio de Facturación (`registrarPago`: solo factura Emitida, bloqueo FOR UPDATE, rechazo de sobrepago, auditoría).
 * Antes comprueba que la factura sea de la empresa Y del libro seleccionado: un id de otra entidad/empresa responde 404 sin tocar nada.
 */
export async function registrarCobroCxc(actor: ActorCxc, entidadId: number, entrada: EntradaCobro): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  await exigirEntidadActiva(actor.empresaId, entidadId);
  const rows = await query<RowDataPacket[]>("SELECT id FROM fact_facturas WHERE id = ? AND empresa_id = ? AND entidad_id = ? LIMIT 1", [entrada.facturaId, actor.empresaId, entidadId]);
  if (!rows[0]) return { ok: false, error: "Factura no encontrada en este libro contable.", status: 404 };
  return registrarPago(actor, entrada.facturaId, {
    fechaPago: entrada.fechaPago, monto: entrada.monto, referencia: entrada.referencia ?? null, medioPago: entrada.medioPago ?? null, observaciones: entrada.observaciones ?? null,
  });
}
