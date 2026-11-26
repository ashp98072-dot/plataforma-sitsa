// PRICESMART KPI — punto de entrada INTERNO (pegamento de laboratorio/sandbox: aquí, y solo aquí, se lee el entorno; la capa `kpi/` es pura y no lee `process.env`) para consultar/exportar los indicadores. Solo SELECT, con el pool de la aplicación.
// Fuera de un sandbox/laboratorio NO opera: el esquema debe llamarse `sandbox_api02_*` y las tablas de PriceSmart deben existir; en producción (sin ellas) responde `{ enabled: false }` sin consultar nada de PriceSmart.
// No es un endpoint público ni define el mecanismo de entrega a PriceSmart (SFTP, Data, API): eso sigue pendiente de acuerdo.
import { getPool } from '@/lib/db';
import { kpiToCsv, type KpiRow } from '../kpi/kpi-model';
import { KpiInputError, loadKpiRows, type KpiFilters } from '../kpi/kpi-source';

export type KpiResult = { enabled: false } | { enabled: true; rows: KpiRow[]; csv: string };
export const kpiEnabledSchema = (): string | null => { const s = String(process.env.DB_NAME ?? ''); return /^sandbox_api02_[a-z0-9_]+$/.test(s) ? s : null; };

export async function consultarKpiPriceSmart(filters: KpiFilters): Promise<KpiResult> {
  const schema = kpiEnabledSchema(); if (!schema) return { enabled: false };
  const pool = getPool();
  try {
    const rows = await loadKpiRows(async (sql, params) => (await pool.execute(sql, params))[0] as Record<string, unknown>[], filters, schema);
    return { enabled: true, rows, csv: kpiToCsv(rows) };
  } catch (e) {
    if ((e as { code?: string })?.code === 'ER_NO_SUCH_TABLE' || (e as { code?: string })?.code === 'ER_BAD_DB_ERROR') return { enabled: false };
    throw e;
  }
}
export { KpiInputError };
