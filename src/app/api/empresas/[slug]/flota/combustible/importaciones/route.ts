import { NextResponse } from "next/server";
import { requireTenantFlotaCombustible } from "@/lib/tenant";
import { listarImportaciones } from "@/lib/flota/combustible-importaciones";
import { importarCombustibleHttp } from "@/lib/flota/combustible-importaciones-http";
export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const g = await requireTenantFlotaCombustible((await ctx.params).slug, "ver"); if (g.error) return g.error;
  return NextResponse.json({ items: await listarImportaciones(g.empresa.id) }, { headers: { "Cache-Control": "private, no-store" } });
}
export async function POST(req: Request, ctx: { params: Promise<{ slug: string }> }) { return importarCombustibleHttp(req, (await ctx.params).slug, true); }
