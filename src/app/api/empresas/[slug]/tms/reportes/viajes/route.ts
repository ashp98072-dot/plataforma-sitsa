import { NextResponse } from "next/server";
import { requireTenantProgramacionOTms } from "@/lib/tenant";
import {
  calcularKpisReporte,
  filtrosReporteDesdeUrl,
  obtenerReporteViajes,
} from "@/lib/tms/reportes-viajes";

type Ctx = { params: Promise<{ slug: string }> };

/**
 * TMS-REPORTES-1 — lectura: mismo permiso ya usado por TMS/Programación
 * (programacion:ver O tms:ver, requireTenantProgramacionOTms) — no se
 * crea un permiso nuevo. Los filtros se parsean en
 * src/lib/tms/reportes-viajes.ts (filtrosReporteDesdeUrl) para que este
 * endpoint y su exportador (export/route.ts) apliquen EXACTAMENTE el
 * mismo criterio.
 */
export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantProgramacionOTms(slug, "ver");
  if (guard.error) return guard.error;

  const filtros = filtrosReporteDesdeUrl(new URL(req.url));
  const planes = await obtenerReporteViajes(guard.empresa.id, filtros);
  const kpi = calcularKpisReporte(planes);

  return NextResponse.json(
    { planes, kpi },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
