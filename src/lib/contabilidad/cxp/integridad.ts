import type { RowDataPacket } from "mysql2/promise";
import Decimal from "decimal.js";
import type { SqlValue } from "@/lib/db";
import { ErrorCxp } from "./errores";
import { conLecturaCxp, enInstantanea, exigirEntidadEnEmpresa, PAGADO, paramsPagos, subPagos } from "./lectura-cxp";
import { desgloseFacturaLectura } from "./saldo-lectura";
import { paginacionCxp } from "./antiguedad-shared";
import { CODIGOS_INTEGRIDAD, CODIGOS_SOLO_PAGOS, filtrosIntegridadDesdeParams, LIMITE_LINEAS, ROTULO_INTEGRIDAD, type FilaIntegridad, type FiltrosIntegridad, type RespuestaIntegridad } from "./integridad-shared";
import type { CodigoAdvertencia } from "./estado-cuenta-shared";
import type { EstadoAdminCxp } from "./saldo";

/** Sólo construye SELECT scoped. Pagina advertencias (no facturas); una factura puede tener más de una. */
export function consultasIntegridad(empresaId: number, entidadId: number, f: FiltrosIntegridad, conPagos: boolean, verPagos: boolean) {
  const scope = (alias: string) => {
    const where = [`${alias}.empresa_id = ?`, `${alias}.entidad_id = ?`];
    const params: SqlValue[] = [empresaId, entidadId];
    if (f.proveedorId) { where.push(`${alias}.proveedor_id = ?`); params.push(f.proveedorId); }
    if (f.estado && alias === "x") { where.push("x.estado_admin = ?"); params.push(f.estado); }
    return { where: where.join(" AND "), params };
  };
  const x = scope("x");
  const facturaFrom = `FROM cxp_facturas x JOIN compras_proveedores p ON p.empresa_id = x.empresa_id AND p.id = x.proveedor_id LEFT JOIN ${subPagos(conPagos)}`;
  const invoiceParams = [...paramsPagos(conPagos, empresaId, entidadId), ...x.params];
  const branches: { sql: string; params: SqlValue[] }[] = [];
  const columnasFactura = `x.id AS factura_id, x.proveedor_id, p.nombre_comercial AS proveedor, CONCAT_WS('-', NULLIF(x.serie,''), x.numero) AS documento,
    x.estado_admin, x.total_documento, x.isr_monto, x.total_neto_pagar AS monto_pagadero, ${PAGADO} AS pagado`;
  for (const [codigo, condicion] of [
    ["SOBREAPLICACION", `${PAGADO} > x.total_neto_pagar`],
    ["PAGO_VIGENTE_EN_ANULADA", `x.estado_admin = 'ANULADA' AND ${PAGADO} > 0`],
  ] as const) {
    if (!f.codigo || f.codigo === codigo) branches.push({
      sql: `SELECT '${codigo}' AS codigo, ${columnasFactura}, NULL AS pago_id, NULL AS estado_pago, NULL AS monto_total, NULL AS suma_aplicaciones, NULL AS monto_aplicado
        ${facturaFrom} WHERE ${x.where} AND ${condicion}`, params: invoiceParams,
    });
  }
  if (conPagos && verPagos) {
    if (!f.codigo || f.codigo === "PAGO_DE_OTRO_PROVEEDOR") branches.push({
      sql: `SELECT 'PAGO_DE_OTRO_PROVEEDOR' AS codigo, ${columnasFactura}, g.id AS pago_id, g.estado AS estado_pago,
          NULL AS monto_total, NULL AS suma_aplicaciones, a.monto AS monto_aplicado
        ${facturaFrom}
        JOIN cxp_pago_aplicaciones a ON a.empresa_id = x.empresa_id AND a.entidad_id = x.entidad_id AND a.factura_id = x.id
        JOIN cxp_pagos g ON g.empresa_id = a.empresa_id AND g.entidad_id = a.entidad_id AND g.id = a.pago_id
        WHERE ${x.where} AND g.proveedor_id <> x.proveedor_id`, params: invoiceParams,
    });
    if (!f.codigo || f.codigo === "PAGO_DESCUADRADO") {
      const g = scope("g");
      // Suma TODAS las aplicaciones del pago dentro del ámbito, antes de filtrar por estado de factura. No prorratear.
      const estado = f.estado ? ` AND EXISTS (SELECT 1 FROM cxp_pago_aplicaciones ax
        JOIN cxp_facturas xf ON xf.empresa_id = ax.empresa_id AND xf.entidad_id = ax.entidad_id AND xf.id = ax.factura_id
        WHERE ax.empresa_id = g.empresa_id AND ax.entidad_id = g.entidad_id AND ax.pago_id = g.id AND xf.estado_admin = ?)` : "";
      branches.push({ sql: `SELECT 'PAGO_DESCUADRADO' AS codigo, NULL AS factura_id, g.proveedor_id, p.nombre_comercial AS proveedor, NULL AS documento,
          NULL AS estado_admin, NULL AS total_documento, NULL AS isr_monto, NULL AS monto_pagadero, NULL AS pagado,
          g.id AS pago_id, g.estado AS estado_pago, g.monto_total, COALESCE(ap.suma,0) AS suma_aplicaciones, NULL AS monto_aplicado
        FROM cxp_pagos g JOIN compras_proveedores p ON p.empresa_id = g.empresa_id AND p.id = g.proveedor_id
        LEFT JOIN (SELECT a.pago_id, SUM(a.monto) AS suma FROM cxp_pago_aplicaciones a
          WHERE a.empresa_id = ? AND a.entidad_id = ? GROUP BY a.pago_id) ap ON ap.pago_id = g.id
        WHERE ${g.where} AND g.monto_total <> COALESCE(ap.suma,0)${estado}`,
        params: [empresaId, entidadId, ...g.params, ...(f.estado ? [f.estado] : [])],
      });
    }
  }
  // Un filtro de pagos con tablas ausentes no fabrica filas ni ejecuta consultas de detalle.
  const empty = `SELECT NULL AS codigo, NULL AS factura_id, NULL AS proveedor_id, NULL AS proveedor, NULL AS documento,
    NULL AS estado_admin, NULL AS total_documento, NULL AS isr_monto, NULL AS monto_pagadero, NULL AS pagado,
    NULL AS pago_id, NULL AS estado_pago, NULL AS monto_total, NULL AS suma_aplicaciones, NULL AS monto_aplicado WHERE 1 = 0`;
  return {
    sql: branches.map(b => b.sql).join(" UNION ALL ") || empty,
    params: branches.flatMap(b => b.params),
    reviewedSql: `SELECT COUNT(*) AS n FROM cxp_facturas x WHERE ${x.where}`, reviewedParams: x.params,
  };
}

const money = (v: unknown) => new Decimal(String(v)).toFixed(2);
export function filaIntegridad(r: RowDataPacket, entidadId: number, verPagos: boolean): FilaIntegridad {
  const codigo = String(r.codigo) as CodigoAdvertencia;
  if (!CODIGOS_INTEGRIDAD.includes(codigo) || (!verPagos && CODIGOS_SOLO_PAGOS.includes(codigo))) throw new Error("Fila de integridad no autorizada");
  const facturaId = r.factura_id == null ? null : Number(r.factura_id);
  const fin = facturaId === null ? null : desgloseFacturaLectura(facturaId, String(r.estado_admin) as EstadoAdminCxp, {
    totalDocumento: String(r.total_documento), isrMonto: String(r.isr_monto), totalNetoPagar: String(r.monto_pagadero),
  }, String(r.pagado));
  let advertencia = fin?.advertenciasIntegridad.find(a => a.codigo === codigo);
  if (codigo === "PAGO_DE_OTRO_PROVEEDOR") advertencia = {
    codigo, facturaId: facturaId!, pagoId: Number(r.pago_id),
    mensaje: `El pago ${r.pago_id} se aplicó a la factura ${facturaId}, que pertenece a otro proveedor.`, detalle: { monto: money(r.monto_aplicado) },
  };
  if (codigo === "PAGO_DESCUADRADO") advertencia = {
    codigo, pagoId: Number(r.pago_id), mensaje: `El total del pago ${r.pago_id} (${money(r.monto_total)}) no coincide con la suma de sus aplicaciones (${money(r.suma_aplicaciones)}).`,
    detalle: { montoTotal: money(r.monto_total), sumaAplicaciones: money(r.suma_aplicaciones) },
  };
  if (!advertencia) throw new Error("Clasificación de integridad inconsistente");
  const fila: FilaIntegridad = {
    entidadId, facturaId, proveedorId: Number(r.proveedor_id), proveedor: String(r.proveedor), documento: r.documento == null ? null : String(r.documento),
    estadoAdmin: r.estado_admin == null ? null : String(r.estado_admin) as EstadoAdminCxp,
    montoPagadero: fin?.montoPagadero ?? null, pagado: fin?.pagado ?? null, excesoAplicado: fin?.excesoAplicado ?? null, advertencia,
  };
  if (verPagos && r.pago_id != null) fila.pago = { id: Number(r.pago_id), estado: String(r.estado_pago) as "REGISTRADO" | "REVERSADO",
    montoTotal: r.monto_total == null ? null : money(r.monto_total), sumaAplicaciones: r.suma_aplicaciones == null ? null : money(r.suma_aplicaciones), montoAplicado: r.monto_aplicado == null ? null : money(r.monto_aplicado) };
  return fila;
}

export async function obtenerIntegridadCxp(empresaId: number, entidadId: number, filtros: FiltrosIntegridad, op: { verPagos: boolean }): Promise<RespuestaIntegridad> {
  const parsed = filtrosIntegridadDesdeParams(new URLSearchParams(Object.entries(filtros).filter(([,v])=>v!==undefined).map(([k,v])=>[k,String(v)])));
  if (!parsed.ok) throw new ErrorCxp(parsed.error, 400, "FILTRO_INVALIDO");
  const f = parsed.filtros;
  if (f.codigo && CODIGOS_SOLO_PAGOS.includes(f.codigo) && !op.verPagos) throw new ErrorCxp("Este tipo de anomalía requiere permiso de Pagos de CxP.", 403, "SIN_PERMISO_PAGOS");
  if (f.codigo === "PAGADO_NO_COINCIDE_CON_LINEAS") throw new ErrorCxp(LIMITE_LINEAS, 422, "ANOMALIA_NO_EVALUABLE");
  const { page, pageSize, offset } = paginacionCxp(f);
  return conLecturaCxp(conPagos => enInstantanea(async c => {
    await exigirEntidadEnEmpresa(c, empresaId, entidadId);
    if (f.proveedorId) {
      const [p] = await c.query<RowDataPacket[]>("SELECT id FROM compras_proveedores WHERE empresa_id = ? AND id = ? LIMIT 1", [empresaId, f.proveedorId]);
      if (!p[0]) throw new ErrorCxp("Proveedor no disponible.", 404, "PROVEEDOR_NO_DISPONIBLE");
    }
    const q = consultasIntegridad(empresaId, entidadId, f, conPagos, op.verPagos);
    const [reviewed] = await c.query<RowDataPacket[]>(q.reviewedSql, q.reviewedParams);
    const [totals] = await c.query<RowDataPacket[]>(`SELECT COUNT(*) AS n, COUNT(DISTINCT factura_id) AS facturas FROM (${q.sql}) hallazgos`, q.params);
    const [counts] = await c.query<RowDataPacket[]>(`SELECT codigo, COUNT(*) AS n FROM (${q.sql}) hallazgos GROUP BY codigo`, q.params);
    const [rows] = await c.query<RowDataPacket[]>(`SELECT * FROM (${q.sql}) hallazgos ORDER BY codigo, factura_id, pago_id LIMIT ? OFFSET ?`, [...q.params, pageSize, offset]);
    const porCodigo: RespuestaIntegridad["porCodigo"] = {};
    if (conPagos) for (const codigo of CODIGOS_INTEGRIDAD) {
      if (codigo === "PAGADO_NO_COINCIDE_CON_LINEAS" || (!op.verPagos && CODIGOS_SOLO_PAGOS.includes(codigo))) continue;
      if (!f.codigo || f.codigo === codigo) porCodigo[codigo] = 0;
    }
    for (const r of counts) {
      const codigo = String(r.codigo) as CodigoAdvertencia;
      if (!CODIGOS_INTEGRIDAD.includes(codigo) || (!op.verPagos && CODIGOS_SOLO_PAGOS.includes(codigo))) throw new Error("Contador de integridad no autorizado");
      porCodigo[codigo] = Number(r.n);
    }
    return {
      entidadId, filtros: f, facturasEnAmbito: Number(reviewed[0].n), facturasRevisadas: conPagos ? Number(reviewed[0].n) : 0,
      totalAdvertencias: Number(totals[0].n), facturasConAnomalias: Number(totals[0].facturas), porCodigo,
      filas: rows.map(r => filaIntegridad(r, entidadId, op.verPagos)), page, pageSize, pagosVisibles: op.verPagos, pagosDisponibles: conPagos,
      limitaciones: [...(op.verPagos ? [LIMITE_LINEAS] : ["Sin permiso de Pagos: sólo se evalúan anomalías de facturas e importes agregados autorizados."]),
        ...(!conPagos ? ["Tablas de pagos pendientes: no se completó la revisión de aplicaciones; cero hallazgos no demuestra ausencia de anomalías."] : [])], rotulo: ROTULO_INTEGRIDAD,
    };
  }, { lecturaRepetible: true }), "el panel de integridad");
}
