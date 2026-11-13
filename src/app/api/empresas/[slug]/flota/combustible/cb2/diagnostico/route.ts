import { NextResponse } from "next/server";
import { requireTenantFlotaCombustible } from "@/lib/tenant";
import { diagnosticoCB2 } from "@/lib/flota/cb2/diagnostico";

export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const guard = await requireTenantFlotaCombustible(slug, "ver");
  if (guard.error) return guard.error;
  return NextResponse.json(diagnosticoCB2(), { headers: { "Cache-Control": "private, no-store" } });
}
