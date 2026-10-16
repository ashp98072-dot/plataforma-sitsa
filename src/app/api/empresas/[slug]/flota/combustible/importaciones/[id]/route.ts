import { NextResponse } from "next/server";
import { requireTenantFlotaCombustible } from "@/lib/tenant";
import { detalleImportacion } from "@/lib/flota/combustible-importaciones";
export async function GET(_req: Request, ctx: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await ctx.params;
  const g = await requireTenantFlotaCombustible(slug, "ver"); if (g.error) return g.error;
  if (!Number.isSafeInteger(Number(id)) || Number(id) <= 0) return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  const data = await detalleImportacion(g.empresa.id, Number(id));
  return NextResponse.json(data ?? { error: "Importación no encontrada." }, { status: data ? 200 : 404, headers: { "Cache-Control": "private, no-store" } });
}
