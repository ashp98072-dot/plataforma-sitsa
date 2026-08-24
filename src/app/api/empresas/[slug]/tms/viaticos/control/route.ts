import { NextResponse } from "next/server";
import { requireTenantViaticos } from "@/lib/tenant";
import { listarViaticosControl, type EstadoViatico } from "@/lib/tms/viaticos";

type Ctx = { params: Promise<{ slug: string }> };

const ESTADOS: EstadoViatico[] = ["PROGRAMADO", "AUTORIZADO", "ENTREGADO", "LIQUIDADO"];

/**
 * VIAT-1 (punto 7) — listado para el panel "Control de Viáticos" en TMS.
 * Permiso EXPLÍCITO `viaticos:ver` (solo lectura; autorizar/entregar/
 * liquidar exigen `viaticos:editar` en sus propios endpoints).
 */
export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantViaticos(slug, "ver");
  if (guard.error) return guard.error;

  const url = new URL(req.url);
  const planIdRaw = url.searchParams.get("planId");
  const planId = planIdRaw && Number.isFinite(Number(planIdRaw)) ? Number(planIdRaw) : undefined;
  const fechaDesde = url.searchParams.get("fechaDesde") || undefined;
  const fechaHasta = url.searchParams.get("fechaHasta") || undefined;
  const empleadoNombre = url.searchParams.get("empleado") || undefined;
  const estadoRaw = url.searchParams.get("estado");
  const estado = estadoRaw && (ESTADOS as string[]).includes(estadoRaw) ? (estadoRaw as EstadoViatico) : undefined;

  const resultado = await listarViaticosControl(guard.empresa.id, {
    planId,
    fechaDesde,
    fechaHasta,
    empleadoNombre,
    estado,
  });
  return NextResponse.json(resultado);
}
