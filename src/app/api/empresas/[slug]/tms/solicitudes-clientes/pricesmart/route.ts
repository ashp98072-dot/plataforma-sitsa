import { NextResponse } from "next/server";
import { requireTenantProgramacionOTms } from "@/lib/tenant";
import { obtenerBandejaPriceSmart } from "@/lib/integrations/pricesmart/lab-demo/ops-view";

/**
 * PRICESMART API-13 (laboratorio) — anotaciones de la bandeja de solicitudes: cuáles nacieron de PriceSmart, cuáles tienen cancelación pedida y qué vinculaciones están pendientes o
 * fallidas. Mismo guard de lectura que el listado de la bandeja. Fuera del laboratorio responde { enabled: false }. Solo de lectura.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const guard = await requireTenantProgramacionOTms(slug);
  if (guard.error) return guard.error;
  return NextResponse.json(await obtenerBandejaPriceSmart(guard.empresa.id), { headers: { "Cache-Control": "private, no-store" } });
}
