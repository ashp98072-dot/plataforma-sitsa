import { query } from "@/lib/db";

/** Detección de la migración de la Fase 3 (sql/migrate-2026-12-fondos-otros.sql). Módulo mínimo: lo importa el servicio de fondos diarios sin arrastrar el catálogo de Gastos. */
const SONDAS = ["SELECT id, plan_id, categoria, monto, empleado_id, metodo_pago, cuenta, pago_pendiente_sync FROM tms_plan_otros_fondos LIMIT 0", "SELECT otro_fondo_id FROM tms_solicitud_fondo_lineas LIMIT 0"] as const;
let cache: { valor: boolean; hasta: number } | null = null;
export function reiniciarDeteccionOtrosFondos() { cache = null; }
/** ¿Se aplicó la migración de la Fase 3? Positivo 5 min, negativo 30 s. */
export async function otrosFondosInstalado(): Promise<boolean> {
  const ahora = Date.now();
  if (cache && cache.hasta > ahora) return cache.valor;
  let valor = true;
  for (const sql of SONDAS) {
    try { await query(sql); } catch { valor = false; break; }
  }
  cache = { valor, hasta: ahora + (valor ? 300_000 : 30_000) };
  return valor;
}

