import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import Decimal from "decimal.js";
import { getPool, type SqlValue } from "@/lib/db";
import { SQL_COBRADO } from "./cobrado";
import { importe } from "./cuentas-por-cobrar-shared";
import {
  LIMITE_EXPORTACION_ANT,
  ROTULO_ANTIGUEDAD,
  TRAMOS_ANTIGUEDAD,
  hoyGuatemala,
  nombreEntidadAnt,
  paginacionAntiguedad,
  saldoExacto,
  type FilaAntiguedad,
  type FiltrosAntiguedad,
  type RespuestaAntiguedad,
  type TotalAntiguedad,
  type TotalMoneda,
  type TramoAntiguedad,
} from "./antiguedad-cxc-shared";

/**
 * MIL-CXC-ANT-01 — Antigüedad de saldos de CxC (MVP). SOLO LECTURA, sin DDL.
 *
 * Fuente: `fact_facturas` Emitidas con saldo ACTUAL > 0. «Cobrado» = `SQL_COBRADO` (única definición: `fact_pagos` + aplicaciones de
 * cobros VIGENTES): un cobro multifactura se escribe SOLO en `fact_cobros`/`fact_cobro_aplicaciones` (nunca en `fact_pagos`), así que
 * el UNION ALL no duplica importes; un cobro ANULADO deja de contar. Facturas Borrador/Anulada quedan fuera.
 * Antigüedad = días desde `fecha_emision` hasta la fecha de corte (hoy, Guatemala). NO es morosidad.
 * Nunca se mezclan monedas: los totales se agrupan por moneda y tramo. Filas y totales se leen en UNA transacción de solo lectura con
 * instantánea consistente, de modo que un cobro concurrente no desfasa la lista de sus totales.
 * Ámbito: la empresa llega de la sesión; la entidad es un filtro DENTRO de esa empresa («sin» = entidad_id NULL, solo facturas históricas).
 */

export class ErrorAntiguedad extends Error {
  constructor(message: string, readonly codigo: string, readonly status: number) {
    super(message);
  }
}

const esEsquemaPendiente = (e: unknown) => {
  const err = e as { code?: string; errno?: number };
  return err?.errno === 1054 || err?.errno === 1146 || err?.code === "ER_BAD_FIELD_ERROR" || err?.code === "ER_NO_SUCH_TABLE";
};

const escaparFecha = (corte: string) => {
  // La fecha se interpola como literal (no como parámetro) para reutilizarla en varias expresiones: SOLO tras validarla estrictamente.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(corte) || new Date(`${corte}T00:00:00Z`).toISOString().slice(0, 10) !== corte) {
    throw new ErrorAntiguedad("Fecha de corte inválida.", "CORTE_INVALIDO", 400);
  }
  return `'${corte}'`;
};

const FROM = `FROM fact_facturas f
     INNER JOIN clientes c ON c.id = f.cliente_id AND c.empresa_id = f.empresa_id
     LEFT JOIN cont_entidades e ON e.empresa_id = f.empresa_id AND e.id = f.entidad_id
     LEFT JOIN (SELECT factura_id, SUM(monto) AS total FROM ${SQL_COBRADO} WHERE empresa_id = ? GROUP BY factura_id) pg ON pg.factura_id = f.id`;
const COBRADO = "COALESCE(pg.total, 0)";

function exprs(corteSql: string) {
  const dias = `GREATEST(0, DATEDIFF(${corteSql}, f.fecha_emision))`;
  const tramo = `CASE WHEN ${dias} <= 15 THEN '0-15' WHEN ${dias} <= 30 THEN '16-30' WHEN ${dias} <= 60 THEN '31-60' WHEN ${dias} <= 90 THEN '61-90' ELSE '90+' END`;
  return { dias, tramo };
}

function condiciones(empresaId: number, f: FiltrosAntiguedad, tramoSql: string) {
  const w = ["f.empresa_id = ?", "f.estado_admin = 'Emitida'", "f.fecha_emision IS NOT NULL", `f.monto_total > ${COBRADO}`];
  const p: SqlValue[] = [empresaId];
  if (f.clienteId) { w.push("f.cliente_id = ?"); p.push(f.clienteId); }
  if (f.entidad === "sin") w.push("f.entidad_id IS NULL");
  else if (typeof f.entidad === "number") { w.push("f.entidad_id = ?"); p.push(f.entidad); }
  if (f.moneda) { w.push("f.moneda = ?"); p.push(f.moneda); }
  if (f.tramo) { w.push(`${tramoSql} = ?`); p.push(f.tramo); }
  // El `?` de la subconsulta de cobrado (empresa) va PRIMERO en el texto SQL.
  return { where: w.join(" AND "), params: [empresaId, ...p] };
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
  id: number; cliente_id: number; cliente: string | null; numero_factura: string | null; fecha_emision: string; dias: number | string;
  monto_total: string; cobrado: string; moneda: string; entidad_id: number | null; entidad_nombre: string | null; tramo: string;
};

async function consultar(empresaId: number, filtros: FiltrosAntiguedad, corte: string, limite: { limit: number; offset: number }) {
  const { dias, tramo } = exprs(escaparFecha(corte));
  const { where, params } = condiciones(empresaId, filtros, tramo);
  try {
    return await enInstantanea(async (c) => {
      const [filas] = await c.query<FilaSql[]>(
        `SELECT f.id, f.cliente_id, COALESCE(f.cliente_nombre_snapshot, c.nombre) AS cliente, f.numero_factura,
                DATE_FORMAT(f.fecha_emision, '%Y-%m-%d') AS fecha_emision, ${dias} AS dias, f.monto_total, ${COBRADO} AS cobrado,
                f.moneda, f.entidad_id, e.nombre AS entidad_nombre, ${tramo} AS tramo
           ${FROM} WHERE ${where}
          ORDER BY f.moneda ASC, f.fecha_emision ASC, f.id ASC LIMIT ? OFFSET ?`,
        [...params, limite.limit, limite.offset],
      );
      const [tot] = await c.query<RowDataPacket[]>(
        `SELECT f.moneda AS moneda, ${tramo} AS tramo, COUNT(*) AS facturas, SUM(f.monto_total - ${COBRADO}) AS saldo
           ${FROM} WHERE ${where} GROUP BY f.moneda, ${tramo} ORDER BY f.moneda ASC`,
        params,
      );
      return { filas, tot };
    });
  } catch (e) {
    if (esEsquemaPendiente(e)) {
      throw new ErrorAntiguedad("Esquema de cobros pendiente. Aplica la migración CxC-1 (y FACT-2/FACT-4) antes de usar esta función.", "MIGRACION_PENDIENTE", 503);
    }
    throw e;
  }
}

function aFila(r: FilaSql): FilaAntiguedad {
  const entidadId = r.entidad_id != null ? Number(r.entidad_id) : null;
  const diasN = Number(r.dias);
  return {
    facturaId: Number(r.id),
    clienteId: Number(r.cliente_id),
    cliente: r.cliente != null && String(r.cliente).trim() ? String(r.cliente) : `Cliente #${r.cliente_id}`,
    numeroFactura: r.numero_factura != null ? String(r.numero_factura) : null,
    fechaEmision: String(r.fecha_emision),
    diasDesdeEmision: diasN,
    montoOriginal: importe(r.monto_total),
    montoCobrado: importe(r.cobrado),
    saldoPendiente: saldoExacto(r.monto_total, r.cobrado),
    moneda: String(r.moneda),
    entidadId,
    entidad: nombreEntidadAnt(entidadId, r.entidad_nombre),
    tramo: String(r.tramo) as TramoAntiguedad,
  };
}

function totales(tot: RowDataPacket[]) {
  const porTramo: TotalAntiguedad[] = tot.map((t) => ({ moneda: String(t.moneda), tramo: String(t.tramo) as TramoAntiguedad, facturas: Number(t.facturas), saldo: importe(t.saldo) }));
  porTramo.sort((a, b) => a.moneda.localeCompare(b.moneda) || TRAMOS_ANTIGUEDAD.indexOf(a.tramo) - TRAMOS_ANTIGUEDAD.indexOf(b.tramo));
  const mapa = new Map<string, { facturas: number; saldo: Decimal }>();
  for (const t of porTramo) {
    const acc = mapa.get(t.moneda) ?? { facturas: 0, saldo: new Decimal(0) };
    acc.facturas += t.facturas;
    acc.saldo = acc.saldo.plus(t.saldo);
    mapa.set(t.moneda, acc);
  }
  const porMoneda: TotalMoneda[] = [...mapa.entries()].map(([moneda, v]) => ({ moneda, facturas: v.facturas, saldo: v.saldo.toFixed(2) }));
  return { porTramo, porMoneda, totalReal: porTramo.reduce((n, t) => n + t.facturas, 0) };
}

export async function listarAntiguedadCxc(empresaId: number, filtros: FiltrosAntiguedad, corte: string = hoyGuatemala()): Promise<RespuestaAntiguedad> {
  const { page, pageSize, offset } = paginacionAntiguedad(filtros);
  const { filas, tot } = await consultar(empresaId, filtros, corte, { limit: pageSize, offset });
  const t = totales(tot);
  return { filas: filas.map(aFila), totalReal: t.totalReal, page, pageSize, fechaCorte: corte, totalesPorTramo: t.porTramo, totalesPorMoneda: t.porMoneda, rotulo: ROTULO_ANTIGUEDAD };
}

/** Conjunto FILTRADO exacto, sin paginar. Si supera el límite se pide acotar (nunca se trunca en silencio). */
export async function listarAntiguedadParaExportar(
  empresaId: number,
  filtros: FiltrosAntiguedad,
  corte: string = hoyGuatemala(),
): Promise<{ ok: true; filas: FilaAntiguedad[]; totales: RespuestaAntiguedad["totalesPorTramo"]; totalesPorMoneda: TotalMoneda[]; fechaCorte: string } | { ok: false; error: string }> {
  const { filas, tot } = await consultar(empresaId, filtros, corte, { limit: LIMITE_EXPORTACION_ANT + 1, offset: 0 });
  if (filas.length > LIMITE_EXPORTACION_ANT) {
    return { ok: false, error: `El filtro devuelve más de ${LIMITE_EXPORTACION_ANT} facturas. Acota por cliente, entidad, moneda o tramo.` };
  }
  const t = totales(tot);
  return { ok: true, filas: filas.map(aFila), totales: t.porTramo, totalesPorMoneda: t.porMoneda, fechaCorte: corte };
}
