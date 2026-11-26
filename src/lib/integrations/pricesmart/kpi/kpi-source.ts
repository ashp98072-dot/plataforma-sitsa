// PRICESMART KPI — lectura de los hechos de SITSA (solo SELECT). Recibe la función de consulta (inyectada) para poder ejecutarse con una cuenta de SOLO LECTURA y probarse con datos reales o simulados.
// Identifica las órdenes de PriceSmart por el VÍNCULO persistido (`ps_api12_tms_links.solicitud_id`), nunca por texto. Todo se acota por EMPRESA (obligatoria) y, si se pide, por cliente del TMS.
// No importa nada de la integración operativa (runtime, transporte, M2M, handlers).
import { buildKpiRow, type KpiFacts, type KpiRow } from './kpi-model';

export type KpiQuery = (sql: string, params: (string | number)[]) => Promise<Record<string, unknown>[]>;
export type KpiFilters = { empresaId: number; clienteId?: number; desde?: string; hasta?: string; limite?: number };
export const KPI_MAX_ROWS = 1000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const str = (v: unknown): string | null => (v == null ? null : v instanceof Date ? localDateTime(v) : String(v));
const dateStr = (v: unknown): string | null => (v == null ? null : v instanceof Date ? localDateTime(v).slice(0, 10) : String(v).slice(0, 10));
const pad = (n: number) => String(n).padStart(2, '0');
const localDateTime = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const isNoTable = (e: unknown) => (e as { code?: string })?.code === 'ER_NO_SUCH_TABLE';

export class KpiInputError extends Error {}

export async function loadKpiRows(query: KpiQuery, filters: KpiFilters, schema: string): Promise<KpiRow[]> {
  if (!Number.isInteger(filters.empresaId) || filters.empresaId <= 0) throw new KpiInputError('empresaId inválido');
  if (!/^sandbox_api02_[a-z0-9_]+$/.test(schema)) throw new KpiInputError('esquema inválido');
  if (filters.clienteId != null && (!Number.isInteger(filters.clienteId) || filters.clienteId <= 0)) throw new KpiInputError('clienteId inválido');
  for (const d of [filters.desde, filters.hasta]) if (d != null && !ISO_DATE.test(d)) throw new KpiInputError('fecha inválida (AAAA-MM-DD)');
  const limite = Math.max(1, Math.min(KPI_MAX_ROWS, Math.trunc(filters.limite ?? 500)));
  const params: (string | number)[] = [filters.empresaId];
  let where = 's.empresa_id = ? AND EXISTS (SELECT 1 FROM `' + schema + '`.ps_api12_tms_links l WHERE l.empresa_id = s.empresa_id AND l.solicitud_id = s.id)';
  if (filters.clienteId != null) { where += ' AND s.cliente_id = ?'; params.push(filters.clienteId); }
  if (filters.desde) { where += ' AND s.fecha_solicitada >= ?'; params.push(filters.desde); }
  if (filters.hasta) { where += ' AND s.fecha_solicitada <= ?'; params.push(filters.hasta); }
  params.push(limite);
  const sols = await query(
    `SELECT s.id, s.referencia_cliente, s.observaciones, s.estado, s.fecha_solicitada, s.hora_solicitada, s.plan_id, p.codigo AS plan_codigo, p.estado AS plan_estado, p.fecha_plan, p.hora_carga
       FROM tms_solicitudes_cliente s LEFT JOIN tms_planes_viaje p ON p.empresa_id = s.empresa_id AND p.id = s.plan_id AND p.cliente_id = s.cliente_id
      WHERE ${where} ORDER BY s.fecha_solicitada, s.id LIMIT ?`, params);
  const planIds = [...new Set(sols.map((r) => r.plan_id).filter((x): x is number => x != null).map(Number))];
  const salidas = new Map<number, string>(); const paradas = new Map<number, { id: number; type: string }[]>(); const confirmaciones = new Map<number, Record<string, unknown>[]>(); let confirmacionesNoDisponibles = false;
  if (planIds.length) {
    const marks = planIds.map(() => '?').join(',');
    for (const r of await query(`SELECT plan_id, MIN(hora_salida) AS salida FROM flota_viajes WHERE empresa_id = ? AND plan_id IN (${marks}) GROUP BY plan_id`, [filters.empresaId, ...planIds])) { const s = str(r.salida); if (s) salidas.set(Number(r.plan_id), s); }
    for (const r of await query(`SELECT pp.id, pp.plan_id, pp.tipo FROM tms_plan_paradas pp JOIN tms_planes_viaje p ON p.id = pp.plan_id AND p.empresa_id = ? WHERE pp.plan_id IN (${marks}) ORDER BY pp.orden`, [filters.empresaId, ...planIds])) {
      const k = Number(r.plan_id); (paradas.get(k) ?? paradas.set(k, []).get(k)!).push({ id: Number(r.id), type: String(r.tipo) });
    }
    try {
      for (const r of await query(`SELECT plan_id, parada_id, resultado, revision, evidencia_id, confirmado_en FROM tms_parada_confirmaciones WHERE empresa_id = ? AND plan_id IN (${marks}) ORDER BY id`, [filters.empresaId, ...planIds])) {
        const k = Number(r.plan_id); (confirmaciones.get(k) ?? confirmaciones.set(k, []).get(k)!).push(r);
      }
    } catch (e) { if (!isNoTable(e)) throw e; confirmacionesNoDisponibles = true; }   // la migración «PARA REVISIÓN» aún no está aplicada: se informa NO_DISPONIBLE, nunca «sin entregas»
  }
  return sols.map((r): KpiRow => {
    const planId = r.plan_id == null ? null : Number(r.plan_id);
    const facts: KpiFacts = {
      solicitudId: Number(r.id), referenciaCliente: r.referencia_cliente == null ? null : String(r.referencia_cliente), observaciones: r.observaciones == null ? null : String(r.observaciones),
      estadoSolicitud: String(r.estado), fechaSolicitada: dateStr(r.fecha_solicitada), horaSolicitada: r.hora_solicitada == null ? null : String(r.hora_solicitada),
      planId, planCodigo: r.plan_codigo == null ? null : String(r.plan_codigo), estadoPlan: r.plan_estado == null ? null : String(r.plan_estado), fechaPlan: dateStr(r.fecha_plan), horaCarga: r.hora_carga == null ? null : String(r.hora_carga),
      salidaEn: planId == null ? null : salidas.get(planId) ?? null, paradas: planId == null ? [] : paradas.get(planId) ?? [],
      confirmaciones: confirmacionesNoDisponibles ? 'UNAVAILABLE' : (planId == null ? [] : confirmaciones.get(planId) ?? []).map((c) => ({ stopId: Number(c.parada_id), result: String(c.resultado), revision: String(c.revision), hasEvidence: c.evidencia_id != null && Number(c.evidencia_id) > 0, confirmadoEn: str(c.confirmado_en) })),
    };
    return buildKpiRow(facts);
  });
}
