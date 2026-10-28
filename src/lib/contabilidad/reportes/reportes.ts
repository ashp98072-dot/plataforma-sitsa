import {resolverPeriodoReporte} from './periodo';
import type { PoolConnection } from "mysql2/promise";
import type { RowDataPacket } from "mysql2";
import { getPool } from "@/lib/db";
import { AccesoContable } from "@/lib/contabilidad/ambito";
import { NOTA_SALDO_ACUMULADO, aCentavos, conSaldoAcumulado, deCentavos, saldosDeCuenta, totalesBalance, totalizar } from "./calculo";

/**
 * M-4 — Reportes contables base: Libro Diario, Libro Mayor y Balance de Comprobación.
 *
 * FUENTE ÚNICA: `cont_asientos` + `cont_asiento_detalle` + `cont_cuentas` (nada de CxC, CxP ni Facturación). Solo asientos en estado
 * 'Registrado' (único estado que el código escribe; no existe anulación/reversión de asientos). Todo es SOLO LECTURA, dentro de una
 * transacción READ ONLY (instantánea consistente) y SIEMPRE acotado por empresa (de la sesión) y entidad (validada contra la empresa).
 * No usa `bloquearAmbito` (que toma FOR UPDATE): consultar un reporte no debe bloquear a quien registra asientos.
 */
export type FiltrosFecha = { desde?: string; hasta?: string; periodoId?: number };
const ESTADO = "Registrado";
export const MAX_LINEAS_MAYOR = 5000;
export const MAX_ASIENTOS_DIARIO = 100;

async function enSolicitudDeLectura<T extends object,F extends FiltrosFecha>(fn: (c: PoolConnection,f:F) => Promise<T>,empresaId:number,entidadId:number,filtros:F) {
  const conn = await getPool().getConnection();
  try {
    await conn.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    await conn.query("START TRANSACTION READ ONLY");
    const {filtros:resueltos,periodoSeleccionado}=await resolverPeriodoReporte(conn,empresaId,entidadId,filtros);
    const r = await fn(conn,resueltos);
    let revisiones:RowDataPacket[]=[];let esquema='DISPONIBLE';
    try{
      [revisiones]=await conn.query<RowDataPacket[]>('SELECT id,estado,version,revision_cierre FROM cont_periodos WHERE empresa_id=? AND entidad_id=? ORDER BY id',[empresaId,entidadId]);
    }catch(error){
      if(!['ER_NO_SUCH_TABLE','ER_BAD_FIELD_ERROR'].includes(String((error as {code?:string}).code)))throw error;
      esquema='SIN_ESQUEMA_C3C2';
    }
    const trazabilidadPeriodo={generadoEn:new Date().toISOString(),esquema,empresaId,entidadId,revisiones,
      alcance:'Datos de la instantánea de lectura; no es una reproducción certificada de un cierre anterior.'};
    await conn.commit();
    return {...r,trazabilidadPeriodo,periodoSeleccionado};
  } catch (e) {
    try { await conn.rollback(); } catch { /* conserva el error original */ }
    throw e;
  } finally { conn.release(); }
}

/** La entidad debe existir EN LA EMPRESA de la sesión (una entidad de otra empresa o inexistente = 404). Las inactivas siguen siendo consultables (historia). */
async function exigirEntidad(c: PoolConnection, empresaId: number, entidadId: number) {
  const [r] = await c.query<RowDataPacket[]>("SELECT id, codigo, nombre FROM cont_entidades WHERE empresa_id = ? AND id = ?", [empresaId, entidadId]);
  if (!r[0]) throw new AccesoContable("Entidad no disponible.", 404);
  return { id: Number(r[0].id), codigo: String(r[0].codigo ?? ""), nombre: String(r[0].nombre ?? "") };
}

function condicionesAsiento(empresaId: number, entidadId: number, f: FiltrosFecha, alias = "a") {
  const w = [`${alias}.empresa_id = ?`, `${alias}.entidad_id = ?`, `${alias}.estado = '${ESTADO}'`];
  const p: (string | number)[] = [empresaId, entidadId];
  if (f.desde) { w.push(`${alias}.fecha >= ?`); p.push(f.desde); }
  if (f.hasta) { w.push(`${alias}.fecha <= ?`); p.push(f.hasta); }
  return { w, p };
}

/* ------------------------------------------------------------------ Libro Diario ------------------------------------------------------------------ */
export type FiltrosDiario = FiltrosFecha & { numero?: string; page?: number };

export async function libroDiario(empresaId: number, entidadId: number, f: FiltrosDiario = {}) {
  const page = Math.max(f.page ?? 1, 1);
  return enSolicitudDeLectura(async (c,f) => {
    const entidad = await exigirEntidad(c, empresaId, entidadId);
    const { w, p } = condicionesAsiento(empresaId, entidadId, f);
    if (f.numero?.trim()) { w.push("a.numero = ?"); p.push(f.numero.trim().slice(0, 40)); }
    const donde = w.join(" AND ");
    const [tot] = await c.query<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM cont_asientos a WHERE ${donde}`, p);
    // Totales de TODO el rango filtrado (no solo de la página) y asientos que no cuadran.
    const [agg] = await c.query<RowDataPacket[]>(
      `SELECT COALESCE(SUM(t.debe), 0) AS debe, COALESCE(SUM(t.haber), 0) AS haber, COALESCE(SUM(t.debe <> t.haber), 0) AS descuadrados
         FROM (SELECT a.id, COALESCE(SUM(d.debe), 0) AS debe, COALESCE(SUM(d.haber), 0) AS haber FROM cont_asientos a
               LEFT JOIN cont_asiento_detalle d ON d.asiento_id = a.id WHERE ${donde} GROUP BY a.id) t`, p);
    const [cab] = await c.query<RowDataPacket[]>(
      `SELECT a.id, a.numero, DATE_FORMAT(a.fecha, '%Y-%m-%d') AS fecha, a.glosa, a.creado_por, DATE_FORMAT(a.creado_en, '%Y-%m-%d %H:%i:%s') AS creado_en
         FROM cont_asientos a WHERE ${donde} ORDER BY a.fecha, a.id LIMIT ? OFFSET ?`, [...p, MAX_ASIENTOS_DIARIO, (page - 1) * MAX_ASIENTOS_DIARIO]);
    const ids = cab.map((r) => Number(r.id));
    const lineas = ids.length ? (await c.query<RowDataPacket[]>(
      `SELECT d.asiento_id, d.cuenta_id, cu.codigo, cu.nombre, d.debe, d.haber FROM cont_asiento_detalle d
         LEFT JOIN cont_cuentas cu ON cu.id = d.cuenta_id AND cu.empresa_id = ? AND cu.entidad_id = ?
        WHERE d.asiento_id IN (${ids.map(() => "?").join(",")}) ORDER BY d.asiento_id, d.id`, [empresaId, entidadId, ...ids]))[0] : [];
    const porAsiento = new Map<number, RowDataPacket[]>();
    for (const l of lineas) { const k = Number(l.asiento_id); (porAsiento.get(k) ?? porAsiento.set(k, []).get(k)!).push(l); }
    const asientos = cab.map((a) => {
      const ls = (porAsiento.get(Number(a.id)) ?? []).map((l) => ({
        cuentaId: Number(l.cuenta_id), codigo: l.codigo != null ? String(l.codigo) : null, cuenta: l.nombre != null ? String(l.nombre) : null,
        debe: deCentavos(aCentavos(l.debe)), haber: deCentavos(aCentavos(l.haber)),
      }));
      const t = totalizar(ls);
      return { id: Number(a.id), numero: String(a.numero), fecha: String(a.fecha), glosa: a.glosa != null ? String(a.glosa) : null, usuario: a.creado_por != null ? String(a.creado_por) : null,
        registradoEn: String(a.creado_en), lineas: ls, totalDebe: t.debe, totalHaber: t.haber, cuadra: t.cuadra };
    });
    return {
      entidad, desde: f.desde ?? null, hasta: f.hasta ?? null, page, pageSize: MAX_ASIENTOS_DIARIO, totalAsientos: Number(tot[0]?.n ?? 0), asientos,
      totalesRango: { debe: deCentavos(aCentavos(agg[0]?.debe)), haber: deCentavos(aCentavos(agg[0]?.haber)), diferencia: deCentavos(aCentavos(agg[0]?.debe) - aCentavos(agg[0]?.haber)), asientosDescuadrados: Number(agg[0]?.descuadrados ?? 0) },
    };
  },empresaId,entidadId,f);
}

/* ------------------------------------------------------------------ Libro Mayor ------------------------------------------------------------------ */
export async function libroMayor(empresaId: number, entidadId: number, cuentaId: number, f: FiltrosFecha = {}) {
  return enSolicitudDeLectura(async (c,f) => {
    const entidad = await exigirEntidad(c, empresaId, entidadId);
    const [cu] = await c.query<RowDataPacket[]>("SELECT id, codigo, nombre, tipo FROM cont_cuentas WHERE empresa_id = ? AND entidad_id = ? AND id = ?", [empresaId, entidadId, cuentaId]);
    if (!cu[0]) throw new AccesoContable("Cuenta no disponible en esta entidad.", 404);
    const { w, p } = condicionesAsiento(empresaId, entidadId, f);
    w.push("d.cuenta_id = ?"); p.push(cuentaId);
    const [rows] = await c.query<RowDataPacket[]>(
      `SELECT a.id AS asiento_id, a.numero, DATE_FORMAT(a.fecha, '%Y-%m-%d') AS fecha, a.glosa, d.debe, d.haber
         FROM cont_asiento_detalle d JOIN cont_asientos a ON a.id = d.asiento_id
        WHERE ${w.join(" AND ")} ORDER BY a.fecha, a.id, d.id LIMIT ?`, [...p, MAX_LINEAS_MAYOR + 1]);
    if (rows.length > MAX_LINEAS_MAYOR) throw new AccesoContable(`El rango tiene más de ${MAX_LINEAS_MAYOR} movimientos en esta cuenta: acota las fechas.`, 422);
    const movimientos = conSaldoAcumulado(rows.map((r) => ({
      asientoId: Number(r.asiento_id), numero: String(r.numero), fecha: String(r.fecha), glosa: r.glosa != null ? String(r.glosa) : null,
      debe: deCentavos(aCentavos(r.debe)), haber: deCentavos(aCentavos(r.haber)),
    })));
    const t = totalizar(movimientos);
    return {
      entidad, cuenta: { id: Number(cu[0].id), codigo: String(cu[0].codigo), nombre: String(cu[0].nombre), tipo: String(cu[0].tipo) },
      desde: f.desde ?? null, hasta: f.hasta ?? null, movimientos,
      totales: { debe: t.debe, haber: t.haber, saldoFinal: movimientos.length ? movimientos[movimientos.length - 1].saldo : "0.00" },
      saldoInicial: null as null, nota: NOTA_SALDO_ACUMULADO,
    };
  },empresaId,entidadId,f);
}

/* ------------------------------------------------------------------ Balance de comprobación ------------------------------------------------------------------ */
export async function balanceComprobacion(empresaId: number, entidadId: number, f: FiltrosFecha & { incluirSinMovimiento?: boolean } = {}) {
  return enSolicitudDeLectura(async (c,f) => {
    const entidad = await exigirEntidad(c, empresaId, entidadId);
    const { w, p } = condicionesAsiento(empresaId, entidadId, f);
    const [mov] = await c.query<RowDataPacket[]>(
      `SELECT d.cuenta_id, SUM(d.debe) AS debito, SUM(d.haber) AS credito FROM cont_asiento_detalle d JOIN cont_asientos a ON a.id = d.asiento_id
        WHERE ${w.join(" AND ")} GROUP BY d.cuenta_id`, p);
    const [cuentas] = await c.query<RowDataPacket[]>("SELECT id, codigo, nombre, tipo, nivel FROM cont_cuentas WHERE empresa_id = ? AND entidad_id = ? ORDER BY codigo", [empresaId, entidadId]);
    const movs = new Map(mov.map((m) => [Number(m.cuenta_id), m]));
    const filas = cuentas
      .filter((cu) => f.incluirSinMovimiento || movs.has(Number(cu.id)))
      .map((cu) => {
        const m = movs.get(Number(cu.id));
        const debito = deCentavos(aCentavos(m?.debito)), credito = deCentavos(aCentavos(m?.credito));
        return { cuentaId: Number(cu.id), codigo: String(cu.codigo), nombre: String(cu.nombre), tipo: String(cu.tipo), nivel: Number(cu.nivel), debito, credito, ...saldosDeCuenta(debito, credito) };
      });
    // Movimientos de líneas cuya cuenta no pertenece a esta entidad (inconsistencia): se muestran, nunca se ocultan.
    const conocidas = new Set(cuentas.map((cu) => Number(cu.id)));
    for (const m of mov) {
      if (conocidas.has(Number(m.cuenta_id))) continue;
      const debito = deCentavos(aCentavos(m.debito)), credito = deCentavos(aCentavos(m.credito));
      filas.push({ cuentaId: Number(m.cuenta_id), codigo: "(sin cuenta)", nombre: "Cuenta no encontrada en esta entidad", tipo: "", nivel: 0, debito, credito, ...saldosDeCuenta(debito, credito) });
    }
    return { entidad, desde: f.desde ?? null, hasta: f.hasta ?? null, incluyeSinMovimiento: !!f.incluirSinMovimiento, filas, totales: totalesBalance(filas) };
  },empresaId,entidadId,f);
}
