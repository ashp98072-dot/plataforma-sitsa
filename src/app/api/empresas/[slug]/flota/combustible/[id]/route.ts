import { guardarCombustibleHttp } from "@/lib/flota/combustible-staff-http";
export async function PATCH(req: Request, ctx: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await ctx.params;
  return guardarCombustibleHttp(req, slug, Number(id));
}
