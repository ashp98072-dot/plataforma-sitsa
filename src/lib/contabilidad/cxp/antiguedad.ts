import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import Decimal from "decimal.js";
import { getPool, type SqlValue } from "@/lib/db";
import { ErrorCxp } from "./errores";
import {
  LIMITE_EXPORTACION_ANT,
  ROTULO_ANTIGUEDAD_CXP,
  SITUACIONES_VENCIMIENTO,
  TRAMOS_ANTIGUEDAD,
  hoyGuatemala,
  paginacionCxp,
  saldoCxp,
  type FilaAntiguedadCxp,
  type FiltrosAntiguedadCxp,
  type RespuestaAntiguedadCxp,
  type SituacionVencimiento,
  type TotalSituacionCxp,
  type TotalTramoCxp,
  type TramoAntiguedad,
} from "./antiguedad-shared";

/**
 * MIL-CXP-01 — Antigüedad de saldos de CxP (proveedores). SOLO LECTURA, sin DDL ni migraciones.
 *
 * Fuente: `cxp_facturas` REGISTRADAS con saldo > 0. Saldo = `total_neto_pagar` (monto pagadero: total − retención de ISR) − pagos REGISTRADOS
 * (`cxp_pago_aplicaciones` de `cxp_pagos` con estado REGISTRADO; los REVERSADOS no cuentan; la retención NO es una aplicación) — la MISMA
 * definición de `aplicaciones.ts`/`saldo.ts`. Las ANULADAS no adeudan nada y quedan fuera.
 * Siempre acotado a (empresa de la sesión, entidad del libro). Filas y totales se leen en UNA transacción de solo lectura con instantánea
 * consistente. Si las tablas de PAGOS aún no existen (migración M-3B1 sin aplicar) no puede haber pagos y el pagado es 0.00 exacto (igual que
 * `obtenerAplicado` en lecturas); si falta `cxp_facturas` (M-3A) responde MIGRACION_PENDIENTE (503).
 */

const esTablaInexistente = (e: unknown) => {
  const err = e as { code?: string; errno?: number };
  return err?.errno === 1146 || err?.code === "ER_NO_SUCH_TABLE";
};
const mencionaPagos = (e: unknown) => /cxp_pago/i.test(String((e as { sqlMessage?: string; message?: string })?.sqlMessage ?? (e as Error)?.message ?? ""));

function literalFecha(corte: string): string {
  // Se interpola como literal (se reutiliza en varias expresiones) SOLO tras validarla estrictamente.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(corte) || new Date(`${corte}T00:00:00Z`).toISOString().slice(0, 10) !== corte) {
    throw new ErrorCxp("Fecha de corte inválida.", 400, "CORTE_INVALIDO");
  }
  return `'${corte}'`;
}

const PAGADO = "COALESCE(pg.total, 0)";
const SUBPAGOS = `(SELECT a.factura_id, SUM(a.monto) AS total
       FROM cxp_pago_aplicaciones a JOIN cxp_pagos g ON g.empresa_id = a.empresa_id AND g.entidad_id = a.entidad_id AND g.id = a.pago_id
      WHERE a.empresa_id = ? AND a.entidad_id = ? AND g.estado = 'REGISTRADO' GROUP BY a.factura_id) pg ON pg.factura_id = x.id`;
// Sin tablas de pagos: subconsulta vacía (sin parámetros) → pagado 0.00 exacto.
const SUBPAGOS_VACIA = "(SELECT NULL AS factura_id, 0 AS total FROM DUAL WHERE 1 = 0) pg ON pg.factura_id = x.id";

function from(conPagos: boolean) {
  return `FROM cxp_facturas x
     JOIN compras_proveedores p ON p.empresa_id = x.empresa_id AND p.id = x.proveedor_id
     LEFT JOIN ${conPagos ? SUBPAGOS : SUBPAGOS_VACIA}`;
}

function exprs(corteSql: string) {
  const dias = `GREATEST(0, DATEDIFF(${corteSql}, x.fecha_documento))`;
  const tramo = `CASE WHEN ${dias} <= 15 THEN '0-15' WHEN ${dias} <= 30 THEN '16-30' WHEN ${dias} <= 60 THEN '31-60' WHEN ${dias} <= 90 THEN '61-90' ELSE '90+' END`;
  const situacion = `CASE WHEN x.fecha_vencimiento IS NULL THEN 'SIN_VENCIMIENTO' WHEN x.fecha_vencimiento < ${corteSql} THEN 'VENCIDA' ELSE 'VIGENTE' END`;
  return { dias, tramo, situacion };
}

function condiciones(empresaId: number, entidadId: number, f: FiltrosAntiguedadCxp, conPagos: boolean, ex: ReturnType<typeof exprs>) {
  const w = ["x.empresa_id = ?", "x.entidad_id = ?", "x.estado_admin = 'REGISTRADA'", `x.total_neto_pagar > ${PAGADO}`];
  const p: SqlValue[] = [empresaId, entidadId];
  if (f.proveedorId) { w.push("x.proveedor_id = ?"); p.push(f.proveedorId); }
  if (f.tramo) { w.push(`${ex.tramo} = ?`); p.push(f.tramo); }
  if (f.situacion) { w.push(`${ex.situacion} = ?`); p.push(f.situacion); }
  // Los `?` de la subconsulta de pagos (empresa, entidad) aparecen PRIMERO en el texto SQL.
  return { where: w.join(" AND "), params: conPagos ? [empresaId, entidadId, ...p] : p };
}

async function enInstantanea<T>(fn: (c: PoolConnection) => Promise<T>): Promise<T> {
  const c = await getPool().getConnection();
  try {
    await c.query("START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY");
    try { return await fn(c); } finally { await c.query("COMMIT"); }
  } finally {
    c.release();
  }
}

type FilaSql = RowDataPacket & {
  id: number; proveedor_id: number; proveedor: string; serie: string; numero: string; fecha_documento: string; fecha_vencimiento: string | null;
  dias: number | string; dias_vencidos: number | string | null; situacion: string; total_documento: string; isr_monto: string; total_neto_pagar: string;
  pagado: string; tramo: string;
};

async function consultarUnaVez(empresaId: number, entidadId: number, filtros: FiltrosAntiguedadCxp, corte: string, limite: { limit: number; offset: number }, conPagos: boolean) {
  const ex = exprs(literalFecha(corte));
  const { where, params } = condiciones(empresaId, entidadId, filtros, conPagos, ex);
  const FROM = from(conPagos);
  return enInstantanea(async (c) => {
    const [filas] = await c.query<FilaSql[]>(
      `SELECT x.id, x.proveedor_id, p.nombre_comercial AS proveedor, x.serie, x.numero,
              DATE_FORMAT(x.fecha_documento, '%Y-%m-%d') AS fecha_documento, DATE_FORMAT(x.fecha_vencimiento, '%Y-%m-%d') AS fecha_vencimiento,
              ${ex.dias} AS dias, CASE WHEN x.fecha_vencimiento IS NULL THEN NULL ELSE GREATEST(0, DATEDIFF(${literalFecha(corte)}, x.fecha_vencimiento)) END AS dias_vencidos,
              ${ex.situacion} AS situacion, x.total_documento, x.isr_monto, x.total_neto_pagar, ${PAGADO} AS pagado, ${ex.tramo} AS tramo
         ${FROM} WHERE ${where}
        ORDER BY p.nombre_comercial ASC, x.fecha_documento ASC, x.id ASC LIMIT ? OFFSET ?`,
      [...params, limite.limit, limite.offset],
    );
    const [tot] = await c.query<RowDataPacket[]>(
      `SELECT ${ex.tramo} AS tramo, ${ex.situacion} AS situacion, COUNT(*) AS facturas, SUM(x.total_neto_pagar - ${PAGADO}) AS saldo
         ${FROM} WHERE ${where} GROUP BY ${ex.tramo}, ${ex.situacion}`,
      params,
    );
    return { filas, tot };
  });
}

async function consultar(empresaId: number, entidadId: number, filtros: FiltrosAntiguedadCxp, corte: string, limite: { limit: number; offset: number }) {
  try {
    return await consultarUnaVez(empresaId, entidadId, filtros, corte, limite, true);
  } catch (e) {
    if (!esTablaInexistente(e)) throw e;
    // Faltan las tablas de pagos (M-3B1): no puede existir ningún pago → pagado 0.00 exacto. Si falta otra tabla, se informa la migración pendiente.
    if (mencionaPagos(e)) {
      try { return await consultarUnaVez(empresaId, entidadId, filtros, corte, limite, false); } catch (e2) { if (!esTablaInexistente(e2)) throw e2; }
    }
    throw new ErrorCxp("Esquema de Cuentas por pagar pendiente. Aplica las migraciones CxP (M-3A y M-3B1) antes de usar este reporte.", 503, "MIGRACION_PENDIENTE");
  }
}

function aFila(r: FilaSql): FilaAntiguedadCxp {
  return {
    facturaId: Number(r.id),
    proveedorId: Number(r.proveedor_id),
    proveedor: String(r.proveedor),
    serie: String(r.serie),
    numero: String(r.numero),
    fechaDocumento: String(r.fecha_documento),
    fechaVencimiento: r.fecha_vencimiento == null ? null : String(r.fecha_vencimiento),
    diasDesdeDocumento: Number(r.dias),
    diasVencidos: r.dias_vencidos == null ? null : Number(r.dias_vencidos),
    situacion: String(r.situacion) as SituacionVencimiento,
    totalDocumento: new Decimal(String(r.total_documento)).toFixed(2),
    retencionIsr: new Decimal(String(r.isr_monto)).toFixed(2),
    montoPagadero: new Decimal(String(r.total_neto_pagar)).toFixed(2),
    pagado: new Decimal(String(r.pagado ?? "0")).toFixed(2),
    saldo: saldoCxp(r.total_neto_pagar, r.pagado),
    tramo: String(r.tramo) as TramoAntiguedad,
  };
}

function totales(tot: RowDataPacket[]) {
  const t: { tramo: TramoAntiguedad; situacion: SituacionVencimiento; n: number; s: Decimal }[] = tot.map((r) => ({
    tramo: String(r.tramo) as TramoAntiguedad, situacion: String(r.situacion) as SituacionVencimiento, n: Number(r.facturas), s: new Decimal(String(r.saldo ?? "0")),
  }));
  const porTramo: TotalTramoCxp[] = TRAMOS_ANTIGUEDAD.map((tramo) => {
    const xs = t.filter((x) => x.tramo === tramo);
    return { tramo, facturas: xs.reduce((a, x) => a + x.n, 0), saldo: xs.reduce((a, x) => a.plus(x.s), new Decimal(0)).toFixed(2) };
  }).filter((x) => x.facturas > 0);
  const porSituacion: TotalSituacionCxp[] = SITUACIONES_VENCIMIENTO.map((situacion) => {
    const xs = t.filter((x) => x.situacion === situacion);
    return { situacion, facturas: xs.reduce((a, x) => a + x.n, 0), saldo: xs.reduce((a, x) => a.plus(x.s), new Decimal(0)).toFixed(2) };
  }).filter((x) => x.facturas > 0);
  return {
    porTramo, porSituacion,
    totalReal: t.reduce((a, x) => a + x.n, 0),
    saldoTotal: t.reduce((a, x) => a.plus(x.s), new Decimal(0)).toFixed(2),
  };
}

export async function listarAntiguedadCxp(empresaId: number, entidadId: number, filtros: FiltrosAntiguedadCxp, corte: string = hoyGuatemala()): Promise<RespuestaAntiguedadCxp> {
  const { page, pageSize, offset } = paginacionCxp(filtros);
  const { filas, tot } = await consultar(empresaId, entidadId, filtros, corte, { limit: pageSize, offset });
  const t = totales(tot);
  return {
    filas: filas.map(aFila), totalReal: t.totalReal, page, pageSize, fechaCorte: corte, moneda: "GTQ",
    totalesPorTramo: t.porTramo, totalesPorSituacion: t.porSituacion, saldoTotal: t.saldoTotal, rotulo: ROTULO_ANTIGUEDAD_CXP,
  };
}

/** Conjunto FILTRADO exacto, sin paginar. Si supera el límite se pide acotar (nunca se trunca en silencio). */
export async function listarAntiguedadCxpParaExportar(
  empresaId: number, entidadId: number, filtros: FiltrosAntiguedadCxp, corte: string = hoyGuatemala(),
): Promise<{ ok: true; filas: FilaAntiguedadCxp[]; totalesPorTramo: TotalTramoCxp[]; totalesPorSituacion: TotalSituacionCxp[]; saldoTotal: string; fechaCorte: string } | { ok: false; error: string }> {
  const { filas, tot } = await consultar(empresaId, entidadId, filtros, corte, { limit: LIMITE_EXPORTACION_ANT + 1, offset: 0 });
  if (filas.length > LIMITE_EXPORTACION_ANT) {
    return { ok: false, error: `El filtro devuelve más de ${LIMITE_EXPORTACION_ANT} facturas. Acota por proveedor, tramo o situación.` };
  }
  const t = totales(tot);
  return { ok: true, filas: filas.map(aFila), totalesPorTramo: t.porTramo, totalesPorSituacion: t.porSituacion, saldoTotal: t.saldoTotal, fechaCorte: corte };
}
