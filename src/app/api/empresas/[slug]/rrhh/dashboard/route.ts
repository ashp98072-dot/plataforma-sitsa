import { NextResponse } from "next/server";
import { requireTenantRrhh } from "@/lib/tenant";
import {
  obtenerEstadisticasDashboard,
  obtenerResumenGerencial,
} from "@/lib/rrhh/dashboard";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "empleados", "ver");
  if (guard.error) return guard.error;
  const [stats, resumenGerencial] = await Promise.all([
    obtenerEstadisticasDashboard(guard.empresa.id),
    obtenerResumenGerencial(guard.empresa.id),
  ]);
  return NextResponse.json({
    stats,
    resumenGerencial,
    empresa: guard.empresa.nombre,
  });
}