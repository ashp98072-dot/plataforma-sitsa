import type { RowDataPacket } from "mysql2/promise";
import { query, type SqlValue } from "@/lib/db";
import {
  LIMITE_EXPORTACION,
  ROTULO_SALDO_INFORMATIVO,
  TEXTO_SIN_ENTIDAD,
  TEXTO_VENCIMIENTO_NO_DISPONIBLE,
  estadoDerivado,
  importe,
  paginacionEfectiva,
  saldoInformativo,
  type ConfirmacionBancariaResumen,
  type EstadoAdminCxc,
  type FilaClienteCxc,
  type FilaCxc,
  type FiltrosCxc,
  type PagoResumen,
  type RespuestaListaCxc,
  type ResumenClienteCxc,
  type TotalesPorEntidad,
} from "./cuentas-por-cobrar-shared";
import Decimal from "decimal.js";

/**
 * M-2a — CUENTAS POR COBRAR INFORMATIVA. SOLO LECTURA.
 *
 * Fuente única: `fact_facturas` + `fact_pagos` (+ `fact_pago_confirmaciones` como atributo). `cont_cxc` NO participa.
 * Saldo informativo = monto_total − Σ fact_pagos. No resta retención esperada, confirmaciones bancarias ni nada más.
 * No hay vencimiento, antigüedad, retenciones reales, notas de crédito, anticipos ni reversos (decisión de M-2a).
 *
 * Rendimiento: UNA consulta principal con pagos agregados por factura (JOIN a un GROUP BY), paginada en SQL, más UNA consulta
 * por lote (página) para el detalle de pagos y UNA para confirmaciones. Nunca una consulta por factura.
 *
 * Tolerancia de esquema: si faltan las columnas/tablas FACT-4 (entidad, condición de pago, retención) se lee el modelo base
 * (entidad «Sin entidad», sin condición ni retención); si falta `fact_pago_confirmaciones` no hay confirmaciones. Nunca DDL.
 */

const esEsquemaPendiente = (e: unknown) => {
  const err = e as { code?: string; errno?: number };
  return err?.errno === 1054 || err?.errno === 1146 || err?.code === "ER_BAD_FIELD_ERROR" || err?.code === "ER_NO_SUCH_TABLE";
};

const escaparLike = (t: string) => t.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Subconsulta de pagos agregados por factura, acotada por empresa (su `?` va PRIMERO en los parámetros). */
const SQL_PAGOS_AGREGADOS = `(SELECT factura_id, SUM(monto) AS total_pagado, COUNT(*) AS cantidad_pagos, MAX(fecha_pago) AS ultima_fecha
     FROM fact_pagos WHERE empresa_id = ? GROUP BY factura_id) pg ON pg.factura_id = f.id`;

type Ctx = { fact4: boolean };

function joins(ctx: Ctx): string {
  return `FROM fact_facturas f
     INNER JOIN clientes c ON c.id = f.cliente_id AND c.empresa_id = f.empresa_id
     ${ctx.fact4 ? "LEFT JOIN cont_entidades e ON e.empresa_id = f.empresa_id AND e.id = f.entidad_id" : ""}
     LEFT JOIN ${SQL_PAGOS_AGREGADOS}`;
}

const PAGADO = "COALESCE(pg.total_pagado, 0)";

/** WHERE + parámetros (empresa primero). `pagosEmpresa` es el `?` de la subconsulta de pagos. */
function dondeDe(f: FiltrosCxc, empresaId: number, ctx: Ctx): { where: string; params: SqlValue[] } {
  const w: string[] = ["f.empresa_id = ?"];
  const p: SqlValue[] = [empresaId];

  const adminPermitidos: EstadoAdminCxc[] = f.estadoAdmin ? [f.estadoAdmin] : ["Emitida", "Anulada"];
  if (f.vista === "cartera") {
    w.push("f.estado_admin = 'Emitida'", `f.monto_total > ${PAGADO}`);
  } else {
    w.push(`f.estado_admin IN (${adminPermitidos.map(() => "?").join(",")})`);
    p.push(...adminPermitidos);
    switch (f.alcance) {
      case "abiertas":
        w.push("f.estado_admin = 'Emitida'", `f.monto_total > ${PAGADO}`);
        break;
      case "pagadas":
        w.push("f.estado_admin = 'Emitida'", `${PAGADO} >= f.monto_total`);
        break;
      case "anuladas":
        w.push("f.estado_admin = 'Anulada'");
        break;
      default:
        break;
    }
  }
  if (f.vista === "cartera" && f.estadoAdmin && f.estadoAdmin !== "Emitida") w.push("1 = 0");

  switch (f.estadoDerivado) {
    case "SIN_PAGOS":
      w.push("f.estado_admin = 'Emitida'", `${PAGADO} <= 0`);
      break;
    case "PARCIAL":
      w.push("f.estado_admin = 'Emitida'", `${PAGADO} > 0`, `${PAGADO} < f.monto_total`);
      break;
    case "PAGADA":
      w.push("f.estado_admin = 'Emitida'", `${PAGADO} >= f.monto_total`);
      break;
    case "ANULADA":
      w.push("f.estado_admin = 'Anulada'");
      break;
    default:
      break;
  }

  if (f.clienteId != null) {
    w.push("f.cliente_id = ?");
    p.push(f.clienteId);
  }
  if (f.entidad === "sin") {
    w.push(ctx.fact4 ? "f.entidad_id IS NULL" : "1 = 1");
  } else if (typeof f.entidad === "number") {
    if (ctx.fact4) {
      w.push("f.entidad_id = ?");
      p.push(f.entidad);
    } else {
      w.push("1 = 0");
    }
  }
  if (f.fechaDesde) {
    w.push("f.fecha_emision >= ?");
    p.push(f.fechaDesde);
  }
  if (f.fechaHasta) {
    w.push("f.fecha_emision <= ?");
    p.push(f.fechaHasta);
  }
  if (f.numeroFactura) {
    w.push("f.numero_factura LIKE ? ESCAPE '\\\\'");
    p.push(`%${escaparLike(f.numeroFactura)}%`);
  }
  if (f.textoCliente) {
    const t = `%${escaparLike(f.textoCliente)}%`;
    w.push("(f.cliente_nombre_snapshot LIKE ? ESCAPE '\\\\' OR c.nombre LIKE ? ESCAPE '\\\\' OR c.razon_social LIKE ? ESCAPE '\\\\')");
    p.push(t, t, t);
  }
  return { where: w.join(" AND "), params: p };
}

/** `empresaId` de la subconsulta de pagos va antes que los de WHERE (orden de aparición en el SQL). */
const conPagos = (empresaId: number, params: SqlValue[]) => [empresaId, ...params];

function ordenDe(f: FiltrosCxc): string {
  return f.vista === "cartera" ? "f.fecha_emision ASC, f.id ASC" : "f.fecha_emision DESC, f.id DESC";
}

/** ¿Están las columnas/tablas FACT-4? (se memoriza solo el éxito: el esquema únicamente se agrega). */
let fact4Visto = false;
async function contexto(): Promise<Ctx> {
  if (fact4Visto) return { fact4: true };
  try {
    await query<RowDataPacket[]>("SELECT entidad_id, condicion_pago, retencion_iva_pct, retencion_iva_monto FROM fact_facturas LIMIT 0", []);
    await query<RowDataPacket[]>("SELECT id FROM cont_entidades LIMIT 0", []);
    fact4Visto = true;
    return { fact4: true };
  } catch (e) {
    if (esEsquemaPendiente(e)) return { fact4: false };
    throw e;
  }
}

const nombreEntidad = (id: number | null, nombre: unknown) =>
  id == null ? TEXTO_SIN_ENTIDAD : nombre != null && String(nombre).trim() ? String(nombre) : `Entidad #${id}`;

type FilaSql = RowDataPacket & {
  id: number; cliente_id: number; cliente: string; numero_factura: string | null; entidad_id?: number | null;
  entidad_nombre?: string | null; fecha_emision: string | null; monto_total: string; estado_admin: string;
  condicion_pago?: string | null; retencion_iva_pct?: number | null; retencion_iva_monto?: string | null;
  total_pagado: string; cantidad_pagos: number; ultima_fecha: string | null;
};

const COLUMNAS_BASE = `f.id, f.cliente_id, COALESCE(f.cliente_nombre_snapshot, c.nombre) AS cliente, f.numero_factura,
       DATE_FORMAT(f.fecha_emision, '%Y-%m-%d') AS fecha_emision, f.monto_total, f.estado_admin,
       ${PAGADO} AS total_pagado, COALESCE(pg.cantidad_pagos, 0) AS cantidad_pagos,
       DATE_FORMAT(pg.ultima_fecha, '%Y-%m-%d') AS ultima_fecha`;
const COLUMNAS_FACT4 = ", f.entidad_id, e.nombre AS entidad_nombre, f.condicion_pago, f.retencion_iva_pct, f.retencion_iva_monto";

async function leerPagosLote(empresaId: number, ids: number[]): Promise<Map<number, PagoResumen[]>> {
  const mapa = new Map<number, PagoResumen[]>();
  if (!ids.length) return mapa;
  const rows = await query<RowDataPacket[]>(
    `SELECT id, factura_id, DATE_FORMAT(fecha_pago, '%Y-%m-%d') AS fecha_pago, monto, referencia, medio_pago
       FROM fact_pagos
      WHERE empresa_id = ? AND factura_id IN (${ids.map(() => "?").join(",")})
      ORDER BY factura_id, fecha_pago, id`,
    [empresaId, ...ids],
  );
  for (const r of rows ?? []) {
    const k = Number(r.factura_id);
    const l = mapa.get(k) ?? [];
    l.push({
      id: Number(r.id),
      fechaPago: String(r.fecha_pago),
      monto: importe(r.monto),
      referencia: r.referencia != null && String(r.referencia).trim() ? String(r.referencia) : null,
      medioPago: r.medio_pago != null ? String(r.medio_pago) : null,
    });
    mapa.set(k, l);
  }
  return mapa;
}

async function leerConfirmacionesLote(empresaId: number, ids: number[]): Promise<Map<number, ConfirmacionBancariaResumen[]>> {
  const mapa = new Map<number, ConfirmacionBancariaResumen[]>();
  if (!ids.length) return mapa;
  try {
    const rows = await query<RowDataPacket[]>(
      `SELECT p.id, p.factura_id, p.estado, p.monto, DATE_FORMAT(p.fecha_acreditacion, '%Y-%m-%d') AS fecha_acreditacion,
              p.referencia, b.banco, b.alias
         FROM fact_pago_confirmaciones p
         LEFT JOIN cont_cuentas_bancarias b ON b.empresa_id = p.empresa_id AND b.entidad_id = p.entidad_id AND b.id = p.cuenta_bancaria_id
        WHERE p.empresa_id = ? AND p.factura_id IN (${ids.map(() => "?").join(",")})
        ORDER BY p.factura_id, p.id`,
      [empresaId, ...ids],
    );
    for (const r of rows ?? []) {
      const k = Number(r.factura_id);
      const l = mapa.get(k) ?? [];
      l.push({
        id: Number(r.id),
        estado: String(r.estado) === "ANULADA" ? "ANULADA" : "CONFIRMADA",
        monto: importe(r.monto),
        fechaAcreditacion: String(r.fecha_acreditacion),
        referencia: String(r.referencia ?? ""),
        banco: r.banco != null ? String(r.banco) : null,
        alias: r.alias != null ? String(r.alias) : null,
      });
      mapa.set(k, l);
    }
  } catch (e) {
    if (!esEsquemaPendiente(e)) throw e;
  }
  return mapa;
}

function aFila(
  r: FilaSql,
  pagos: PagoResumen[] | undefined,
  confirmaciones: ConfirmacionBancariaResumen[] | undefined,
): FilaCxc {
  const estadoAdmin = String(r.estado_admin) as EstadoAdminCxc;
  const monto = importe(r.monto_total);
  const pagado = importe(r.total_pagado);
  const estado = estadoDerivado(estadoAdmin, monto, pagado) ?? "SIN_PAGOS";
  const entidadId = r.entidad_id != null ? Number(r.entidad_id) : null;
  const pct = Number(r.retencion_iva_pct ?? 0);
  const retMonto = importe(r.retencion_iva_monto);
  const tieneRetencion = pct > 0 || new Decimal(retMonto).gt(0);
  const cond = r.condicion_pago === "CREDITO" || r.condicion_pago === "CONTADO" ? r.condicion_pago : null;
  const ultimoPago = pagos?.length ? pagos[pagos.length - 1] : null;
  const activas = (confirmaciones ?? []).filter((c) => c.estado === "CONFIRMADA");
  return {
    facturaId: Number(r.id),
    clienteId: Number(r.cliente_id),
    cliente: String(r.cliente),
    numeroFactura: r.numero_factura != null ? String(r.numero_factura) : null,
    entidadId,
    entidad: nombreEntidad(entidadId, r.entidad_nombre),
    fechaEmision: r.fecha_emision != null ? String(r.fecha_emision) : null,
    estadoAdmin,
    estadoFinanciero: estado,
    condicionPago: cond,
    montoOriginal: monto,
    totalPagado: pagado,
    saldoInformativo: estadoAdmin === "Anulada" ? null : saldoInformativo(monto, pagado),
    retencionEsperada: tieneRetencion ? { porcentaje: pct, monto: retMonto } : null,
    netoEsperado: tieneRetencion ? new Decimal(monto).minus(retMonto).toFixed(2) : null,
    cantidadPagos: Number(r.cantidad_pagos ?? 0),
    ultimaFechaPago: r.ultima_fecha != null ? String(r.ultima_fecha) : null,
    ultimaReferenciaPago: ultimoPago?.referencia ?? null,
    confirmacionBancaria: {
      cantidadActivas: activas.length,
      totalConfirmado: activas.reduce((s, c) => s.plus(c.monto), new Decimal(0)).toFixed(2),
      ultima: confirmaciones?.length ? confirmaciones[confirmaciones.length - 1] : null,
    },
    vencimiento: TEXTO_VENCIMIENTO_NO_DISPONIBLE,
  };
}

/** Consulta principal. Reintenta en modelo base si faltan columnas FACT-4 (nunca ejecuta DDL). */
async function consultaPrincipal(
  empresaId: number,
  f: FiltrosCxc,
  ctx: Ctx,
  limit: number,
  offset: number,
): Promise<{ rows: FilaSql[]; ctx: Ctx }> {
  const { where, params } = dondeDe(f, empresaId, ctx);
  const sql = `SELECT ${COLUMNAS_BASE}${ctx.fact4 ? COLUMNAS_FACT4 : ""}
     ${joins(ctx)}
    WHERE ${where}
    ORDER BY ${ordenDe(f)}
    LIMIT ? OFFSET ?`;
  try {
    const rows = await query<FilaSql[]>(sql, [...conPagos(empresaId, params), limit, offset]);
    return { rows: rows ?? [], ctx };
  } catch (e) {
    if (ctx.fact4 && esEsquemaPendiente(e)) {
      const base: Ctx = { fact4: false };
      return consultaPrincipal(empresaId, f, base, limit, offset);
    }
    throw e;
  }
}

async function totalesPorEntidad(empresaId: number, f: FiltrosCxc, ctx: Ctx): Promise<{ total: number; porEntidad: TotalesPorEntidad[] }> {
  const { where, params } = dondeDe(f, empresaId, ctx);
  const sql = `SELECT ${ctx.fact4 ? "f.entidad_id, MAX(e.nombre) AS entidad_nombre," : "NULL AS entidad_id, NULL AS entidad_nombre,"}
         COUNT(*) AS cantidad,
         COALESCE(SUM(CASE WHEN f.estado_admin = 'Emitida' THEN f.monto_total ELSE 0 END), 0) AS monto_original,
         COALESCE(SUM(CASE WHEN f.estado_admin = 'Emitida' THEN ${PAGADO} ELSE 0 END), 0) AS total_pagado,
         COALESCE(SUM(CASE WHEN f.estado_admin = 'Emitida' AND f.monto_total > ${PAGADO} THEN f.monto_total - ${PAGADO} ELSE 0 END), 0) AS saldo
       ${joins(ctx)}
      WHERE ${where}
      GROUP BY ${ctx.fact4 ? "f.entidad_id" : "1"}
      ORDER BY ${ctx.fact4 ? "f.entidad_id IS NULL, f.entidad_id" : "1"}`;
  const rows = await query<RowDataPacket[]>(sql, conPagos(empresaId, params));
  let total = 0;
  const porEntidad: TotalesPorEntidad[] = (rows ?? []).map((r) => {
    const id = r.entidad_id != null ? Number(r.entidad_id) : null;
    total += Number(r.cantidad);
    return {
      entidadId: id,
      entidad: nombreEntidad(id, r.entidad_nombre),
      cantidad: Number(r.cantidad),
      montoOriginal: importe(r.monto_original),
      totalPagado: importe(r.total_pagado),
      saldoInformativo: importe(r.saldo),
    };
  });
  return { total, porEntidad };
}

/** Lista paginada (Cartera abierta o Historial según `filtros.vista`). */
export async function listarCuentasPorCobrar(empresaId: number, filtros: FiltrosCxc): Promise<RespuestaListaCxc> {
  const { page, pageSize, offset } = paginacionEfectiva(filtros);
  const ctx0 = await contexto();
  const { rows, ctx } = await consultaPrincipal(empresaId, filtros, ctx0, pageSize, offset);
  const ids = rows.map((r) => Number(r.id));
  const [pagos, confirmaciones, tot] = await Promise.all([
    leerPagosLote(empresaId, ids),
    leerConfirmacionesLote(empresaId, ids),
    totalesPorEntidad(empresaId, filtros, ctx),
  ]);
  return {
    filas: rows.map((r) => aFila(r, pagos.get(Number(r.id)), confirmaciones.get(Number(r.id)))),
    totalReal: tot.total,
    page,
    pageSize,
    porEntidad: tot.porEntidad,
    rotulo: ROTULO_SALDO_INFORMATIVO,
  };
}

/** Exporta EXACTAMENTE el conjunto filtrado (sin paginar). Si excede el tope, avisa (no trunca en silencio). */
export async function listarParaExportar(
  empresaId: number,
  filtros: FiltrosCxc,
): Promise<{ ok: true; filas: FilaCxc[] } | { ok: false; error: string }> {
  const ctx0 = await contexto();
  const { rows } = await consultaPrincipal(empresaId, filtros, ctx0, LIMITE_EXPORTACION + 1, 0);
  if (rows.length > LIMITE_EXPORTACION) {
    return { ok: false, error: `El filtro devuelve más de ${LIMITE_EXPORTACION} facturas. Acota por cliente, entidad o fechas.` };
  }
  const filas: FilaCxc[] = [];
  const LOTE = 500;
  for (let i = 0; i < rows.length; i += LOTE) {
    const trozo = rows.slice(i, i + LOTE);
    const ids = trozo.map((r) => Number(r.id));
    const [pagos, confirmaciones] = await Promise.all([leerPagosLote(empresaId, ids), leerConfirmacionesLote(empresaId, ids)]);
    for (const r of trozo) filas.push(aFila(r, pagos.get(Number(r.id)), confirmaciones.get(Number(r.id))));
  }
  return { ok: true, filas };
}

// ─────────────────────────────────────── por cliente ───────────────────────────────────────

const AGREGADOS_CLIENTE = `COUNT(*) AS cantidad,
         COALESCE(SUM(CASE WHEN f.estado_admin = 'Emitida' THEN f.monto_total ELSE 0 END), 0) AS facturado,
         COALESCE(SUM(CASE WHEN f.estado_admin = 'Emitida' THEN ${PAGADO} ELSE 0 END), 0) AS pagado,
         COALESCE(SUM(CASE WHEN f.estado_admin = 'Emitida' AND f.monto_total > ${PAGADO} THEN f.monto_total - ${PAGADO} ELSE 0 END), 0) AS saldo,
         COALESCE(SUM(CASE WHEN f.estado_admin = 'Emitida' AND f.monto_total > ${PAGADO} THEN 1 ELSE 0 END), 0) AS abiertas,
         COALESCE(SUM(CASE WHEN f.estado_admin = 'Emitida' AND ${PAGADO} >= f.monto_total THEN 1 ELSE 0 END), 0) AS pagadas,
         COALESCE(SUM(CASE WHEN f.estado_admin = 'Anulada' THEN 1 ELSE 0 END), 0) AS anuladas`;

const base = (): Pick<FiltrosCxc, "vista"> => ({ vista: "historial" });

/** Resumen de UN cliente, una fila POR ENTIDAD (nunca se suman entidades distintas). `null` si el cliente no es de la empresa. */
export async function resumenCliente(
  empresaId: number,
  clienteId: number,
  entidad?: FiltrosCxc["entidad"],
): Promise<ResumenClienteCxc | null> {
  const ctx = await contexto();
  const [c] = (await query<RowDataPacket[]>(
    "SELECT id, nombre, razon_social, nit FROM clientes WHERE empresa_id = ? AND id = ? LIMIT 1",
    [empresaId, clienteId],
  )) ?? [];
  if (!c) return null;
  const { where, params } = dondeDe({ ...base(), clienteId, entidad }, empresaId, ctx);
  const rows = await query<RowDataPacket[]>(
    `SELECT ${ctx.fact4 ? "f.entidad_id, MAX(e.nombre) AS entidad_nombre," : "NULL AS entidad_id, NULL AS entidad_nombre,"} ${AGREGADOS_CLIENTE}
       ${joins(ctx)}
      WHERE ${where}
      GROUP BY ${ctx.fact4 ? "f.entidad_id" : "1"}
      ORDER BY ${ctx.fact4 ? "f.entidad_id IS NULL, f.entidad_id" : "1"}`,
    conPagos(empresaId, params),
  );
  return {
    clienteId: Number(c.id),
    cliente: String(c.razon_social ?? c.nombre),
    nit: c.nit != null ? String(c.nit) : null,
    porEntidad: (rows ?? []).map((r) => {
      const id = r.entidad_id != null ? Number(r.entidad_id) : null;
      return {
        entidadId: id,
        entidad: nombreEntidad(id, r.entidad_nombre),
        totalFacturadoRegistrado: importe(r.facturado),
        totalPagadoRegistrado: importe(r.pagado),
        saldoInformativoAbierto: importe(r.saldo),
        cantidadFacturas: Number(r.cantidad),
        abiertas: Number(r.abiertas),
        pagadas: Number(r.pagadas),
        anuladas: Number(r.anuladas),
      };
    }),
    rotulo: ROTULO_SALDO_INFORMATIVO,
  };
}

/** Índice de clientes (una fila por cliente × entidad), ordenado por saldo informativo abierto. */
export async function listarClientesCxc(
  empresaId: number,
  filtros: Pick<FiltrosCxc, "entidad" | "textoCliente" | "page" | "pageSize">,
): Promise<{ filas: FilaClienteCxc[]; totalReal: number; page: number; pageSize: number; rotulo: typeof ROTULO_SALDO_INFORMATIVO }> {
  const { page, pageSize, offset } = paginacionEfectiva(filtros);
  const ctx = await contexto();
  const { where, params } = dondeDe({ ...base(), entidad: filtros.entidad, textoCliente: filtros.textoCliente }, empresaId, ctx);
  const grupo = ctx.fact4 ? "f.cliente_id, f.entidad_id" : "f.cliente_id";
  const [conteo] = (await query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM (SELECT 1 ${joins(ctx)} WHERE ${where} GROUP BY ${grupo}) g`,
    conPagos(empresaId, params),
  )) ?? [];
  const rows = await query<RowDataPacket[]>(
    `SELECT f.cliente_id, MAX(COALESCE(f.cliente_nombre_snapshot, c.nombre)) AS cliente,
            ${ctx.fact4 ? "f.entidad_id, MAX(e.nombre) AS entidad_nombre," : "NULL AS entidad_id, NULL AS entidad_nombre,"} ${AGREGADOS_CLIENTE}
       ${joins(ctx)}
      WHERE ${where}
      GROUP BY ${grupo}
      ORDER BY saldo DESC, cliente ASC, f.cliente_id ASC
      LIMIT ? OFFSET ?`,
    [...conPagos(empresaId, params), pageSize, offset],
  );
  return {
    filas: (rows ?? []).map((r) => {
      const id = r.entidad_id != null ? Number(r.entidad_id) : null;
      return {
        clienteId: Number(r.cliente_id),
        cliente: String(r.cliente),
        entidadId: id,
        entidad: nombreEntidad(id, r.entidad_nombre),
        cantidadFacturas: Number(r.cantidad),
        abiertas: Number(r.abiertas),
        pagadas: Number(r.pagadas),
        anuladas: Number(r.anuladas),
        totalFacturadoRegistrado: importe(r.facturado),
        totalPagadoRegistrado: importe(r.pagado),
        saldoInformativoAbierto: importe(r.saldo),
      };
    }),
    totalReal: Number(conteo?.total ?? 0),
    page,
    pageSize,
    rotulo: ROTULO_SALDO_INFORMATIVO,
  };
}

export type PagoClienteFila = PagoResumen & { facturaId: number; numeroFactura: string | null; entidad: string };
export type ConfirmacionClienteFila = ConfirmacionBancariaResumen & { facturaId: number; numeroFactura: string | null; entidad: string };

/** Pagos de las facturas del cliente (paginado, acotado por empresa y entidad opcional). */
export async function listarPagosCliente(
  empresaId: number,
  clienteId: number,
  opciones: { entidad?: FiltrosCxc["entidad"]; page?: number; pageSize?: number } = {},
): Promise<{ filas: PagoClienteFila[]; totalReal: number; page: number; pageSize: number }> {
  const { page, pageSize, offset } = paginacionEfectiva(opciones);
  const ctx = await contexto();
  const w = ["p.empresa_id = ?", "f.cliente_id = ?"];
  const params: SqlValue[] = [empresaId, clienteId];
  if (opciones.entidad === "sin") w.push(ctx.fact4 ? "f.entidad_id IS NULL" : "1 = 1");
  else if (typeof opciones.entidad === "number") {
    w.push(ctx.fact4 ? "f.entidad_id = ?" : "1 = 0");
    if (ctx.fact4) params.push(opciones.entidad);
  }
  const desde = `FROM fact_pagos p
       INNER JOIN fact_facturas f ON f.id = p.factura_id AND f.empresa_id = p.empresa_id
       ${ctx.fact4 ? "LEFT JOIN cont_entidades e ON e.empresa_id = f.empresa_id AND e.id = f.entidad_id" : ""}
      WHERE ${w.join(" AND ")}`;
  const [conteo] = (await query<RowDataPacket[]>(`SELECT COUNT(*) AS total ${desde}`, params)) ?? [];
  const rows = await query<RowDataPacket[]>(
    `SELECT p.id, p.factura_id, f.numero_factura, ${ctx.fact4 ? "f.entidad_id, e.nombre AS entidad_nombre," : "NULL AS entidad_id, NULL AS entidad_nombre,"}
            DATE_FORMAT(p.fecha_pago, '%Y-%m-%d') AS fecha_pago, p.monto, p.referencia, p.medio_pago
       ${desde}
      ORDER BY p.fecha_pago DESC, p.id DESC
      LIMIT ? OFFSET ?`,
    [...params, pageSize, offset],
  );
  return {
    filas: (rows ?? []).map((r) => ({
      id: Number(r.id),
      facturaId: Number(r.factura_id),
      numeroFactura: r.numero_factura != null ? String(r.numero_factura) : null,
      entidad: nombreEntidad(r.entidad_id != null ? Number(r.entidad_id) : null, r.entidad_nombre),
      fechaPago: String(r.fecha_pago),
      monto: importe(r.monto),
      referencia: r.referencia != null && String(r.referencia).trim() ? String(r.referencia) : null,
      medioPago: r.medio_pago != null ? String(r.medio_pago) : null,
    })),
    totalReal: Number(conteo?.total ?? 0),
    page,
    pageSize,
  };
}

/** Confirmaciones bancarias de las facturas del cliente (atributo informativo; no altera ningún saldo). */
export async function listarConfirmacionesCliente(
  empresaId: number,
  clienteId: number,
  opciones: { entidad?: FiltrosCxc["entidad"]; page?: number; pageSize?: number } = {},
): Promise<{ filas: ConfirmacionClienteFila[]; totalReal: number; page: number; pageSize: number }> {
  const { page, pageSize, offset } = paginacionEfectiva(opciones);
  const ctx = await contexto();
  const w = ["p.empresa_id = ?", "f.cliente_id = ?"];
  const params: SqlValue[] = [empresaId, clienteId];
  if (opciones.entidad === "sin") w.push(ctx.fact4 ? "f.entidad_id IS NULL" : "1 = 1");
  else if (typeof opciones.entidad === "number") {
    w.push(ctx.fact4 ? "f.entidad_id = ?" : "1 = 0");
    if (ctx.fact4) params.push(opciones.entidad);
  }
  try {
    const desde = `FROM fact_pago_confirmaciones p
         INNER JOIN fact_facturas f ON f.id = p.factura_id AND f.empresa_id = p.empresa_id
         ${ctx.fact4 ? "LEFT JOIN cont_entidades e ON e.empresa_id = f.empresa_id AND e.id = f.entidad_id" : ""}
         LEFT JOIN cont_cuentas_bancarias b ON b.empresa_id = p.empresa_id AND b.entidad_id = p.entidad_id AND b.id = p.cuenta_bancaria_id
        WHERE ${w.join(" AND ")}`;
    const [conteo] = (await query<RowDataPacket[]>(`SELECT COUNT(*) AS total ${desde}`, params)) ?? [];
    const rows = await query<RowDataPacket[]>(
      `SELECT p.id, p.factura_id, f.numero_factura, ${ctx.fact4 ? "f.entidad_id, e.nombre AS entidad_nombre," : "NULL AS entidad_id, NULL AS entidad_nombre,"}
              p.estado, p.monto, DATE_FORMAT(p.fecha_acreditacion, '%Y-%m-%d') AS fecha_acreditacion, p.referencia, b.banco, b.alias
         ${desde}
        ORDER BY p.fecha_acreditacion DESC, p.id DESC
        LIMIT ? OFFSET ?`,
      [...params, pageSize, offset],
    );
    return {
      filas: (rows ?? []).map((r) => ({
        id: Number(r.id),
        facturaId: Number(r.factura_id),
        numeroFactura: r.numero_factura != null ? String(r.numero_factura) : null,
        entidad: nombreEntidad(r.entidad_id != null ? Number(r.entidad_id) : null, r.entidad_nombre),
        estado: String(r.estado) === "ANULADA" ? ("ANULADA" as const) : ("CONFIRMADA" as const),
        monto: importe(r.monto),
        fechaAcreditacion: String(r.fecha_acreditacion),
        referencia: String(r.referencia ?? ""),
        banco: r.banco != null ? String(r.banco) : null,
        alias: r.alias != null ? String(r.alias) : null,
      })),
      totalReal: Number(conteo?.total ?? 0),
      page,
      pageSize,
    };
  } catch (e) {
    if (esEsquemaPendiente(e)) return { filas: [], totalReal: 0, page, pageSize };
    throw e;
  }
}
