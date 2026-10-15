import { estacionGuardar } from "@/lib/flota/combustible-estaciones-http";
export async function PATCH(req: Request, ctx: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await ctx.params;
  return estacionGuardar(req, slug, Number(id));
}
