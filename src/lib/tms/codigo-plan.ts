import type { RowDataPacket } from "mysql2";
import { query } from "@/lib/db";

/** Prefijo estable: PLAN-YYYYMMDD-### (único por empresa). */
export function prefijoCodigoPlan(fechaPlan: string): string {
  const ymd = fechaPlan.replace(/-/g, "").slice(0, 8);
  return `PLAN-${ymd}-`;
}

export async function generarCodigoPlan(
  empresaId: number,
  fechaPlan: string,
): Promise<string> {
  const prefix = prefijoCodigoPlan(fechaPlan);
  const rows = await query<RowDataPacket[]>(
    `SELECT codigo FROM tms_planes_viaje
     WHERE empresa_id = ? AND codigo LIKE ?
     ORDER BY id DESC
     LIMIT 40`,
    [empresaId, `${prefix}%`],
  );
  let max = 0;
  for (const r of rows) {
    const m = String(r.codigo ?? "").match(/-(\d+)$/);
    if (m) max = Math.max(max, Number(m[1]) || 0);
  }
  return `${prefix}${String(max + 1).padStart(3, "0")}`;
}

/** Si el código ya existe, propone el siguiente del mismo día. */
export async function asegurarCodigoPlanUnico(
  empresaId: number,
  fechaPlan: string,
  deseado?: string | null,
): Promise<string> {
  let codigo = (deseado ?? "").trim();
  if (!codigo) {
    codigo = await generarCodigoPlan(empresaId, fechaPlan);
  }
  for (let i = 0; i < 8; i++) {
    const hit = await query<RowDataPacket[]>(
      `SELECT id FROM tms_planes_viaje
       WHERE empresa_id = ? AND codigo = ? LIMIT 1`,
      [empresaId, codigo],
    );
    if (!hit[0]) return codigo;
    codigo = await generarCodigoPlan(empresaId, fechaPlan);
  }
  return `${prefijoCodigoPlan(fechaPlan)}${Date.now().toString().slice(-5)}`;
}
