import { NextResponse } from "next/server";
import { requireTenantFlotaCombustible } from "@/lib/tenant";
import { catalogosCombustible } from "@/lib/flota/combustible-staff";
export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const guard = await requireTenantFlotaCombustible(slug, "editar");
  if (guard.error) return guard.error;
  return NextResponse.json(await catalogosCombustible(guard.empresa.id), { headers: { "Cache-Control": "private, no-store" } });
}
