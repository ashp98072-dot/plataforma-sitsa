import { NextResponse } from "next/server";
import { requireTenantFacturacion } from "@/lib/tenant";
import { obtenerKpisFacturacion } from "@/lib/facturacion/facturas";

type Ctx = { params: Promise<{ slug: string }> };

/**
 * FACT-1-UI (Fase C) — KPI agregados con SQL sobre TODO el universo de la
 * empresa (nunca sobre pageSize). facturacion:ver. Nunca tms:ver.
 */
export async function GET(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantFacturacion(slug, "ver");
  if (guard.error) return guard.error;

  const kpi = await obtenerKpisFacturacion(guard.empresa.id);
  return NextResponse.json({ kpi }, { headers: { "Cache-Control": "private, no-store" } });
}
