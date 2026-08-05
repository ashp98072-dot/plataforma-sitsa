import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { query } from "@/lib/db";
import { requireTenantFlotaAny } from "@/lib/tenant";
import { asegurarSchemaFlota } from "@/lib/flota/schema";
import { listarParadasDelPlan } from "@/lib/tms/paradas";

type Ctx = { params: Promise<{ slug: string; id: string }> };

/** Paradas del plan TMS enlazado al viaje + estado de evidencias. */
export async function GET(_req: Request, ctx: Ctx) {
  const { slug, id: raw } = await ctx.params;
  const guard = await requireTenantFlotaAny(
    slug,
    ["flota_piloto", "flota_reportes"],
    "ver",
  );
  if (guard.error) return guard.error;

  try {
    await asegurarSchemaFlota();
  } catch {
    /* ok */
  }

  const viajeId = Number(raw);
  if (!viajeId) {
    return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  }

  const viaje = await query<RowDataPacket[]>(
    `SELECT v.id, v.plan_id, v.estado, ve.placa
     FROM flota_viajes v
     INNER JOIN flota_vehiculos ve ON ve.id = v.vehiculo_id
     WHERE v.id = ? AND v.empresa_id = ? LIMIT 1`,
    [viajeId, guard.empresa.id],
  );

  if (!viaje[0]) {
    return NextResponse.json({ error: "Viaje no encontrado." }, { status: 404 });
  }

  const planId = viaje[0].plan_id != null ? Number(viaje[0].plan_id) : null;
  if (!planId) {
    return NextResponse.json({
      planId: null,
      paradas: [],
      pendientes: 0,
    });
  }

  const paradas = await listarParadasDelPlan(planId);
  return NextResponse.json({
    planId,
    paradas,
    pendientes: paradas.filter((p) => p.requiere_evidencia && p.evidencias < 1)
      .length,
  });
}
