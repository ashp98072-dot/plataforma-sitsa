import { requerimientoEstadoCambiar } from "@/lib/compras/requerimiento-estado-api";
type Ctx = { params: Promise<{ slug: string; id: string }> };
export async function POST(req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  return requerimientoEstadoCambiar(req, slug, id);
}
