import { requerimientoExportar } from "@/lib/compras/requerimiento-exportaciones-api";
export const runtime = "nodejs";
export async function GET(_req: Request, ctx: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await ctx.params;
  return requerimientoExportar(slug, id, "pdf");
}
