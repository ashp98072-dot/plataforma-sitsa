import type { RowDataPacket } from "mysql2";
import { execute, query } from "@/lib/db";

export type TipoParada = "Carga" | "Descarga" | "Entrega";

export type PlanParada = {
  id: number;
  plan_id: number;
  orden: number;
  lugar_id: number | null;
  lugar_nombre: string;
  tipo: string;
  requiere_evidencia: boolean;
  evidencias: number;
};

export type ParadaInput = {
  lugarNombre: string;
  tipo?: TipoParada | string;
  requiereEvidencia?: boolean;
  lugarId?: number | null;
};

export async function listarParadasDelPlan(
  planId: number,
): Promise<PlanParada[]> {
  const rows = await query<RowDataPacket[]>(
    `SELECT pp.id, pp.plan_id, pp.orden, pp.lugar_id, pp.lugar_nombre, pp.tipo,
            pp.requiere_evidencia,
            (SELECT COUNT(*) FROM tms_evidencias ev
             WHERE ev.parada_id = pp.id) AS evidencias
     FROM tms_plan_paradas pp
     WHERE pp.plan_id = ?
     ORDER BY pp.orden ASC, pp.id ASC`,
    [planId],
  ).catch(() => [] as RowDataPacket[]);

  return rows.map((r) => ({
    id: Number(r.id),
    plan_id: Number(r.plan_id),
    orden: Number(r.orden),
    lugar_id: r.lugar_id != null ? Number(r.lugar_id) : null,
    lugar_nombre: String(r.lugar_nombre),
    tipo: String(r.tipo ?? "Entrega"),
    requiere_evidencia: Number(r.requiere_evidencia ?? 1) === 1,
    evidencias: Number(r.evidencias ?? 0),
  }));
}

export async function guardarParadasPlan(
  empresaId: number,
  planId: number,
  paradas: ParadaInput[],
): Promise<void> {
  await execute("DELETE FROM tms_plan_paradas WHERE plan_id = ?", [planId]);
  let orden = 1;
  for (const p of paradas) {
    const nombre = (p.lugarNombre || "").trim();
    if (!nombre) continue;
    const tipo = String(p.tipo || "Entrega");
    let lugarId = p.lugarId ?? null;
    if (!lugarId) {
      const existing = await query<RowDataPacket[]>(
        "SELECT id FROM tms_lugares WHERE empresa_id = ? AND nombre = ? LIMIT 1",
        [empresaId, nombre],
      );
      if (existing[0]) {
        lugarId = Number(existing[0].id);
      } else {
        const r = await execute(
          "INSERT INTO tms_lugares (empresa_id, nombre, tipo) VALUES (?, ?, ?)",
          [empresaId, nombre, tipo === "Carga" ? "Carga" : "Descarga"],
        );
        lugarId = Number(r.insertId);
      }
    }
    await execute(
      `INSERT INTO tms_plan_paradas
        (plan_id, orden, lugar_id, lugar_nombre, tipo, requiere_evidencia)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        planId,
        orden++,
        lugarId,
        nombre,
        tipo,
        p.requiereEvidencia === false ? 0 : 1,
      ],
    );
  }
}

/** Paradas que aún no tienen evidencia (requiere_evidencia = 1). */
export async function paradasPendientesEvidencia(
  planId: number,
): Promise<PlanParada[]> {
  const all = await listarParadasDelPlan(planId);
  return all.filter((p) => p.requiere_evidencia && p.evidencias < 1);
}

export async function validarParadaDelPlan(
  empresaId: number,
  planId: number,
  paradaId: number,
): Promise<PlanParada | null> {
  const rows = await query<RowDataPacket[]>(
    `SELECT pp.id, pp.plan_id, pp.orden, pp.lugar_id, pp.lugar_nombre, pp.tipo,
            pp.requiere_evidencia
     FROM tms_plan_paradas pp
     INNER JOIN tms_planes_viaje p ON p.id = pp.plan_id
     WHERE pp.id = ? AND pp.plan_id = ? AND p.empresa_id = ?
     LIMIT 1`,
    [paradaId, planId, empresaId],
  ).catch(() => [] as RowDataPacket[]);
  if (!rows[0]) return null;
  return {
    id: Number(rows[0].id),
    plan_id: Number(rows[0].plan_id),
    orden: Number(rows[0].orden),
    lugar_id: rows[0].lugar_id != null ? Number(rows[0].lugar_id) : null,
    lugar_nombre: String(rows[0].lugar_nombre),
    tipo: String(rows[0].tipo ?? "Entrega"),
    requiere_evidencia: Number(rows[0].requiere_evidencia ?? 1) === 1,
    evidencias: 0,
  };
}
