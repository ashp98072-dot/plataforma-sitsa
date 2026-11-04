import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import Decimal from "decimal.js";
import type { SqlValue } from "@/lib/db";
import { ErrorCxp } from "./errores";
import { PAGADO, conLecturaCxp, enInstantanea, exigirEntidadEnEmpresa, exprsVencimiento, literalFecha, paramsPagos, subPagos } from "./lectura-cxp";
import { desgloseFinanciero, type EstadoFinancieroCxp } from "./saldo";
import { SITUACIONES_VENCIMIENTO, hoyGuatemala, type SituacionVencimiento } from "./antiguedad-shared";
import {
  LIMITE_EXPORTACION_ANT,
  NOTA_MONEDA_ESTADO_CUENTA,
  ROTULO_ESTADO_CUENTA,
  claseDocumento,
  paginacionCxp,
  saldoCrudo,
  type AdvertenciaIntegridad,
  type FilaEstadoCuenta,
  type FiltrosEstadoCuenta,
  type LineaPagoEstado,
  type ProveedorEstado,
  type RespuestaEstadoCuenta,
  type TotalesEstadoCuenta,
} from "./estado-cuenta-shared";

/**
 * MIL-CXP-02 — Estado de cuenta por proveedor (ACTUAL). SOLO LECTURA, sin DDL ni migraciones.
 *
 * Una sola transacción de solo lectura con instantánea consistente lee: proveedor, facturas de la página, totales del CONJUNTO FILTRADO (no de la
 * página), líneas de pagos (solo con `verPagos`) y advertencias de integridad. El «pagado» es la definición compartida de `lectura-cxp.ts`
 * (aplicaciones de pagos REGISTRADOS) y el desglose financiero es `desgloseFinanciero` de `saldo.ts`: no se duplica lógica.
 * Los importes originales NUNCA se modifican ni se normalizan: ante una inconsistencia se emite una advertencia verificable (con identificadores).
 * Alcance de permisos: `verPagos` (cxp_pagos) y `verFiscal` (cxp_proveedor_fiscal) los decide la capa HTTP; aquí, sin ellos, la información NO se consulta.
 */

export type OpcionesEstado = { verPagos: boolean; verFiscal: boolean };
const MAX_ADVERTENCIAS = 50;

type FilaSql = RowDataPacket & {
  id: number; serie: string; numero: string; fecha_documento: string; fecha_vencimiento: string | null; dias: number | string; dias_vencidos: number | string | null;
  situacion: string; total_documento: string; isr_monto: string; total_neto_pagar: string; estado_admin: "REGISTRADA" | "ANULADA"; motivo_anulacion: string | null; pagado: string;
};

function condiciones(empresaId: number, entidadId: number, f: FiltrosEstadoCuenta, conPagos: boolean) {
  const w = ["x.empresa_id = ?", "x.entidad_id = ?", "x.proveedor_id = ?"];
  const p: SqlValue[] = [empresaId, entidadId, f.proveedorId];
  if (f.desde) { w.push("x.fecha_documento >= ?"); p.push(f.desde); }
  if (f.hasta) { w.push("x.fecha_documento <= ?"); p.push(f.hasta); }
  // Abiertas por defecto (D3); pagadas y anuladas solo si se piden.
  const o = [`(x.estado_admin = 'REGISTRADA' AND x.total_neto_pagar > ${PAGADO})`];
  if (f.incluirPagadas) o.push(`(x.estado_admin = 'REGISTRADA' AND x.total_neto_pagar <= ${PAGADO})`);
  if (f.incluirAnuladas) o.push("x.estado_admin = 'ANULADA'");
  w.push(`(${o.join(" OR ")})`);
  return { where: w.join(" AND "), params: [...paramsPagos(conPagos, empresaId, entidadId), ...p] };
}

const FROM = (conPagos: boolean) => `FROM cxp_facturas x LEFT JOIN ${subPagos(conPagos)}`;
const CLASE = `CASE WHEN x.estado_admin = 'ANULADA' THEN 'ANULADA' WHEN x.total_neto_pagar > ${PAGADO} THEN 'ABIERTA' ELSE 'PAGADA' END`;
const dec = (v: unknown) => new Decimal(String(v ?? "0"));

async function proveedor(c: PoolConnection, empresaId: number, entidadId: number, proveedorId: number, verFiscal: boolean): Promise<ProveedorEstado> {
  // Solo nombre comercial, NIT y días de crédito (D6). NUNCA banco, cuenta, titular ni contactos.
  const [rows] = await c.query<RowDataPacket[]>("SELECT id, nombre_comercial, nit, dias_credito FROM compras_proveedores WHERE empresa_id = ? AND id = ? LIMIT 1", [empresaId, proveedorId]);
  const r = rows[0];
  if (!r) throw new ErrorCxp("Proveedor no disponible.", 404, "PROVEEDOR_NO_DISPONIBLE");
  let regimenFiscal: ProveedorEstado["regimenFiscal"] = null, sujetoIsr: boolean | null = null;
  if (verFiscal) {
    const [f] = await c.query<RowDataPacket[]>("SELECT regimen_fiscal, sujeto_isr FROM cxp_proveedor_fiscal WHERE empresa_id = ? AND entidad_id = ? AND proveedor_id = ? LIMIT 1", [empresaId, entidadId, proveedorId]);
    if (f[0]) { regimenFiscal = String(f[0].regimen_fiscal) as ProveedorEstado["regimenFiscal"]; sujetoIsr = Number(f[0].sujeto_isr) === 1; }
  }
  return {
    id: Number(r.id), nombre: String(r.nombre_comercial), nit: r.nit != null && String(r.nit).trim() ? String(r.nit) : null,
    diasCredito: r.dias_credito == null ? null : Number(r.dias_credito), regimenFiscal, sujetoIsr,
  };
}

function aFila(r: FilaSql, lineas: LineaPagoEstado[] | undefined, advertencias: AdvertenciaIntegridad[]): FilaEstadoCuenta {
  const anulada = r.estado_admin === "ANULADA";
  const importes = { totalDocumento: String(r.total_documento), isrMonto: String(r.isr_monto), totalNetoPagar: String(r.total_neto_pagar) };
  let estadoFinanciero: EstadoFinancieroCxp, saldo: string;
  try {
    // Misma lógica que Facturas/Pagos. Lanza RangeError si hay sobreaplicación (no representable): se informa y NO se normaliza.
    const fin = desgloseFinanciero(r.estado_admin, importes, String(r.pagado));
    estadoFinanciero = fin.estadoFinanciero;
    saldo = fin.saldo;
  } catch (e) {
    if (!(e instanceof RangeError)) throw e;
    estadoFinanciero = "PAGADA";
    saldo = saldoCrudo(r.total_neto_pagar, r.pagado); // crudo (negativo): se muestra tal cual, con su advertencia
  }
  const fila: FilaEstadoCuenta = {
    facturaId: Number(r.id), serie: String(r.serie), numero: String(r.numero), documento: `${r.serie ? `${r.serie}-` : ""}${r.numero}`,
    fechaDocumento: String(r.fecha_documento), fechaVencimiento: r.fecha_vencimiento == null ? null : String(r.fecha_vencimiento),
    diasDesdeDocumento: Number(r.dias), diasVencidos: anulada || r.dias_vencidos == null ? null : Number(r.dias_vencidos),
    situacion: anulada ? null : (String(r.situacion) as SituacionVencimiento), estado: claseDocumento(r.estado_admin, r.total_neto_pagar, r.pagado), estadoFinanciero,
    totalDocumento: dec(r.total_documento).toFixed(2), retencionIsr: dec(r.isr_monto).toFixed(2), montoPagadero: dec(r.total_neto_pagar).toFixed(2),
    pagado: dec(r.pagado).toFixed(2), saldo, motivoAnulacion: r.motivo_anulacion == null ? null : String(r.motivo_anulacion),
  };
  if (lineas) {
    fila.pagos = lineas;
    const suma = lineas.filter((l) => l.vigente).reduce((a, l) => a.plus(l.monto), new Decimal(0)).toFixed(2);
    if (suma !== fila.pagado) {
      advertencias.push({ codigo: "PAGADO_NO_COINCIDE_CON_LINEAS", facturaId: fila.facturaId, mensaje: `El pagado vigente de ${fila.documento} (${fila.pagado}) no coincide con la suma de sus líneas de pago registradas (${suma}).`, detalle: { pagado: fila.pagado, sumaLineas: suma } });
    }
  }
  return fila;
}

async function lineasDePagos(c: PoolConnection, empresaId: number, entidadId: number, ids: number[]): Promise<Map<number, LineaPagoEstado[]>> {
  const mapa = new Map<number, LineaPagoEstado[]>(ids.map((id) => [id, []]));
  for (let i = 0; i < ids.length; i += 1000) {
    const trozo = ids.slice(i, i + 1000);
    const [rows] = await c.query<RowDataPacket[]>(
      `SELECT a.factura_id, a.pago_id, a.monto, DATE_FORMAT(g.fecha_pago, '%Y-%m-%d') AS fecha_pago, g.medio_pago, g.referencia, g.estado,
              DATE_FORMAT(g.reversado_en, '%Y-%m-%d %H:%i:%s') AS reversado_en, g.motivo_reversion
         FROM cxp_pago_aplicaciones a JOIN cxp_pagos g ON g.empresa_id = a.empresa_id AND g.entidad_id = a.entidad_id AND g.id = a.pago_id
        WHERE a.empresa_id = ? AND a.entidad_id = ? AND a.factura_id IN (${trozo.map(() => "?").join(",")}) ORDER BY g.fecha_pago ASC, g.id ASC`,
      [empresaId, entidadId, ...trozo],
    );
    for (const r of rows) {
      mapa.get(Number(r.factura_id))!.push({
        pagoId: Number(r.pago_id), fechaPago: String(r.fecha_pago), medioPago: String(r.medio_pago), referencia: String(r.referencia), monto: dec(r.monto).toFixed(2),
        estado: String(r.estado) as LineaPagoEstado["estado"], vigente: String(r.estado) === "REGISTRADO",
        reversadoEn: r.reversado_en == null ? null : String(r.reversado_en), motivoReversion: r.motivo_reversion == null ? null : String(r.motivo_reversion),
      });
    }
  }
  return mapa;
}

/** Advertencias de integridad del proveedor en la entidad (no dependen del filtro). Solo se EMITEN; nunca modifican importes. */
async function advertenciasIntegridad(c: PoolConnection, empresaId: number, entidadId: number, proveedorId: number, conPagos: boolean, verPagos: boolean) {
  const out: AdvertenciaIntegridad[] = [];
  let omitidas = 0;
  const tope = (n: number) => { if (n > MAX_ADVERTENCIAS) { omitidas += n - MAX_ADVERTENCIAS; } };
  const base = `FROM cxp_facturas x LEFT JOIN ${subPagos(conPagos)} WHERE x.empresa_id = ? AND x.entidad_id = ? AND x.proveedor_id = ?`;
  const p = [...paramsPagos(conPagos, empresaId, entidadId), empresaId, entidadId, proveedorId];

  const [sobre] = await c.query<RowDataPacket[]>(`SELECT x.id, x.serie, x.numero, x.total_neto_pagar, ${PAGADO} AS pagado ${base} AND x.estado_admin = 'REGISTRADA' AND ${PAGADO} > x.total_neto_pagar ORDER BY x.id LIMIT ${MAX_ADVERTENCIAS + 1}`, p);
  tope(sobre.length);
  for (const r of sobre.slice(0, MAX_ADVERTENCIAS)) {
    const exceso = dec(r.pagado).minus(String(r.total_neto_pagar)).toFixed(2);
    out.push({ codigo: "SOBREAPLICACION", facturaId: Number(r.id), mensaje: `La factura ${r.serie}-${r.numero} tiene pagos aplicados por encima de su monto pagadero (exceso ${exceso}).`, detalle: { montoPagadero: dec(r.total_neto_pagar).toFixed(2), pagado: dec(r.pagado).toFixed(2), exceso } });
  }
  const [anul] = await c.query<RowDataPacket[]>(`SELECT x.id, x.serie, x.numero, ${PAGADO} AS pagado ${base} AND x.estado_admin = 'ANULADA' AND ${PAGADO} > 0 ORDER BY x.id LIMIT ${MAX_ADVERTENCIAS + 1}`, p);
  tope(anul.length);
  for (const r of anul.slice(0, MAX_ADVERTENCIAS)) {
    out.push({ codigo: "PAGO_VIGENTE_EN_ANULADA", facturaId: Number(r.id), mensaje: `La factura anulada ${r.serie}-${r.numero} conserva pagos vigentes aplicados (${dec(r.pagado).toFixed(2)}).`, detalle: { pagado: dec(r.pagado).toFixed(2) } });
  }
  if (conPagos && verPagos) {
    // Datos de pagos: solo se consultan y se informan con permiso de Pagos.
    const [otro] = await c.query<RowDataPacket[]>(
      `SELECT a.pago_id, a.factura_id, a.monto FROM cxp_pago_aplicaciones a
         JOIN cxp_pagos g ON g.empresa_id = a.empresa_id AND g.entidad_id = a.entidad_id AND g.id = a.pago_id
         JOIN cxp_facturas f ON f.empresa_id = a.empresa_id AND f.entidad_id = a.entidad_id AND f.id = a.factura_id
        WHERE a.empresa_id = ? AND a.entidad_id = ? AND g.proveedor_id <> f.proveedor_id AND (g.proveedor_id = ? OR f.proveedor_id = ?) ORDER BY a.pago_id, a.factura_id LIMIT ${MAX_ADVERTENCIAS + 1}`,
      [empresaId, entidadId, proveedorId, proveedorId],
    );
    tope(otro.length);
    for (const r of otro.slice(0, MAX_ADVERTENCIAS)) {
      out.push({ codigo: "PAGO_DE_OTRO_PROVEEDOR", pagoId: Number(r.pago_id), facturaId: Number(r.factura_id), mensaje: `El pago ${r.pago_id} se aplicó a la factura ${r.factura_id}, que pertenece a otro proveedor.`, detalle: { monto: dec(r.monto).toFixed(2) } });
    }
    const [desc] = await c.query<RowDataPacket[]>(
      `SELECT g.id, g.monto_total, COALESCE(SUM(a.monto), 0) AS suma FROM cxp_pagos g
         LEFT JOIN cxp_pago_aplicaciones a ON a.empresa_id = g.empresa_id AND a.entidad_id = g.entidad_id AND a.pago_id = g.id
        WHERE g.empresa_id = ? AND g.entidad_id = ? AND g.proveedor_id = ? GROUP BY g.id, g.monto_total HAVING g.monto_total <> COALESCE(SUM(a.monto), 0) ORDER BY g.id LIMIT ${MAX_ADVERTENCIAS + 1}`,
      [empresaId, entidadId, proveedorId],
    );
    tope(desc.length);
    for (const r of desc.slice(0, MAX_ADVERTENCIAS)) {
      out.push({ codigo: "PAGO_DESCUADRADO", pagoId: Number(r.id), mensaje: `El total del pago ${r.id} (${dec(r.monto_total).toFixed(2)}) no coincide con la suma de sus aplicaciones (${dec(r.suma).toFixed(2)}).`, detalle: { montoTotal: dec(r.monto_total).toFixed(2), sumaAplicaciones: dec(r.suma).toFixed(2) } });
    }
  }
  return { advertencias: out, omitidas };
}

function totalizar(tot: RowDataPacket[]): TotalesEstadoCuenta {
  const filas = tot.map((r) => ({
    clase: String(r.clase) as "ABIERTA" | "PAGADA" | "ANULADA", situacion: String(r.situacion) as SituacionVencimiento, n: Number(r.n),
    td: dec(r.td), isr: dec(r.isr), pag: dec(r.pag), pagado: dec(r.pagado), saldo: dec(r.saldo_pos),
  }));
  const suma = (xs: typeof filas, k: "td" | "isr" | "pag" | "pagado" | "saldo") => xs.reduce((a, x) => a.plus(x[k]), new Decimal(0)).toFixed(2);
  const reg = filas.filter((x) => x.clase !== "ANULADA"), ab = filas.filter((x) => x.clase === "ABIERTA"), pg = filas.filter((x) => x.clase === "PAGADA"), an = filas.filter((x) => x.clase === "ANULADA");
  return {
    registradas: { facturas: reg.reduce((a, x) => a + x.n, 0), totalDocumento: suma(reg, "td"), retencionIsr: suma(reg, "isr"), montoPagadero: suma(reg, "pag"), pagado: suma(reg, "pagado"), saldoExigible: suma(reg, "saldo") },
    abiertas: { facturas: ab.reduce((a, x) => a + x.n, 0), saldo: suma(ab, "saldo") },
    pagadas: { facturas: pg.reduce((a, x) => a + x.n, 0) },
    porSituacion: SITUACIONES_VENCIMIENTO.map((s) => {
      const xs = ab.filter((x) => x.situacion === s);
      return { situacion: s, facturas: xs.reduce((a, x) => a + x.n, 0), saldo: suma(xs, "saldo") };
    }).filter((x) => x.facturas > 0),
    anuladas: { facturas: an.reduce((a, x) => a + x.n, 0), totalDocumento: suma(an, "td"), retencionIsr: suma(an, "isr"), montoPagadero: suma(an, "pag") },
  };
}

async function consultarUnaVez(empresaId: number, entidadId: number, f: FiltrosEstadoCuenta, op: OpcionesEstado, corte: string, limite: { limit: number; offset: number }, conPagos: boolean) {
  const ex = exprsVencimiento(literalFecha(corte));
  const { where, params } = condiciones(empresaId, entidadId, f, conPagos);
  return enInstantanea(async (c) => {
    await exigirEntidadEnEmpresa(c, empresaId, entidadId);
    const prov = await proveedor(c, empresaId, entidadId, f.proveedorId, op.verFiscal);
    const [filas] = await c.query<FilaSql[]>(
      `SELECT x.id, x.serie, x.numero, DATE_FORMAT(x.fecha_documento, '%Y-%m-%d') AS fecha_documento, DATE_FORMAT(x.fecha_vencimiento, '%Y-%m-%d') AS fecha_vencimiento,
              ${ex.dias} AS dias, ${ex.diasVencidos} AS dias_vencidos, ${ex.situacion} AS situacion, x.total_documento, x.isr_monto, x.total_neto_pagar,
              x.estado_admin, x.motivo_anulacion, ${PAGADO} AS pagado
         ${FROM(conPagos)} WHERE ${where} ORDER BY x.fecha_documento ASC, x.id ASC LIMIT ? OFFSET ?`,
      [...params, limite.limit, limite.offset],
    );
    const [tot] = await c.query<RowDataPacket[]>(
      `SELECT ${CLASE} AS clase, ${ex.situacion} AS situacion, COUNT(*) AS n, SUM(x.total_documento) AS td, SUM(x.isr_monto) AS isr, SUM(x.total_neto_pagar) AS pag,
              SUM(${PAGADO}) AS pagado, SUM(GREATEST(x.total_neto_pagar - ${PAGADO}, 0)) AS saldo_pos
         ${FROM(conPagos)} WHERE ${where} GROUP BY ${CLASE}, ${ex.situacion}`,
      params,
    );
    // Sin permiso de Pagos: ni se consulta. Con permiso pero sin tablas de pagos (M-3B1 pendiente) no puede haber pagos → líneas vacías.
    const ids = filas.map((r) => Number(r.id));
    const lineas = op.verPagos ? (conPagos ? await lineasDePagos(c, empresaId, entidadId, ids) : new Map<number, LineaPagoEstado[]>(ids.map((id) => [id, []]))) : null;
    const integ = await advertenciasIntegridad(c, empresaId, entidadId, f.proveedorId, conPagos, op.verPagos);
    return { prov, filas, tot, lineas, integ };
  });
}

async function consultar(empresaId: number, entidadId: number, f: FiltrosEstadoCuenta, op: OpcionesEstado, corte: string, limite: { limit: number; offset: number }) {
  let conPagosUsado = true;
  const r = await conLecturaCxp((conPagos) => { conPagosUsado = conPagos; return consultarUnaVez(empresaId, entidadId, f, op, corte, limite, conPagos); }, "el estado de cuenta");
  return { ...r, conPagos: conPagosUsado };
}

function armar(r: Awaited<ReturnType<typeof consultar>>, op: OpcionesEstado) {
  const adv = [...r.integ.advertencias];
  const filas = r.filas.map((x) => aFila(x, r.lineas ? r.lineas.get(Number(x.id)) ?? [] : undefined, adv));
  return { filas, totales: totalizar(r.tot), advertencias: adv, omitidas: r.integ.omitidas, pagosVisibles: op.verPagos };
}

export async function obtenerEstadoCuentaCxp(
  empresaId: number, entidadId: number, filtros: FiltrosEstadoCuenta, op: OpcionesEstado, corte: string = hoyGuatemala(),
): Promise<RespuestaEstadoCuenta> {
  const { page, pageSize, offset } = paginacionCxp(filtros);
  const r = await consultar(empresaId, entidadId, filtros, op, corte, { limit: pageSize, offset });
  const a = armar(r, op);
  return {
    proveedor: r.prov, filtros: { incluirPagadas: filtros.incluirPagadas, incluirAnuladas: filtros.incluirAnuladas, desde: filtros.desde ?? null, hasta: filtros.hasta ?? null },
    filas: a.filas, totalReal: a.totales.registradas.facturas + a.totales.anuladas.facturas, page, pageSize, fechaCorte: corte, moneda: "GTQ", totales: a.totales,
    advertencias: a.advertencias, advertenciasOmitidas: a.omitidas, pagosVisibles: a.pagosVisibles, rotulo: ROTULO_ESTADO_CUENTA, notaMoneda: NOTA_MONEDA_ESTADO_CUENTA,
  };
}

/** Conjunto FILTRADO exacto, sin paginar. Si supera el límite se pide acotar (nunca se trunca en silencio). */
export async function exportarEstadoCuentaCxp(
  empresaId: number, entidadId: number, filtros: FiltrosEstadoCuenta, op: OpcionesEstado, corte: string = hoyGuatemala(),
): Promise<{ ok: true; datos: RespuestaEstadoCuenta } | { ok: false; error: string }> {
  const r = await consultar(empresaId, entidadId, filtros, op, corte, { limit: LIMITE_EXPORTACION_ANT + 1, offset: 0 });
  if (r.filas.length > LIMITE_EXPORTACION_ANT) {
    return { ok: false, error: `El filtro devuelve más de ${LIMITE_EXPORTACION_ANT} facturas. Acota por fechas del documento o excluye pagadas/anuladas.` };
  }
  const a = armar(r, op);
  return {
    ok: true,
    datos: {
      proveedor: r.prov, filtros: { incluirPagadas: filtros.incluirPagadas, incluirAnuladas: filtros.incluirAnuladas, desde: filtros.desde ?? null, hasta: filtros.hasta ?? null },
      filas: a.filas, totalReal: a.filas.length, page: 1, pageSize: a.filas.length, fechaCorte: corte, moneda: "GTQ", totales: a.totales,
      advertencias: a.advertencias, advertenciasOmitidas: a.omitidas, pagosVisibles: a.pagosVisibles, rotulo: ROTULO_ESTADO_CUENTA, notaMoneda: NOTA_MONEDA_ESTADO_CUENTA,
    },
  };
}
