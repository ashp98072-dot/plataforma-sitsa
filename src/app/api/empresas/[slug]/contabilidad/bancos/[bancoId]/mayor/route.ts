import { bancosMayorHttp } from "@/lib/contabilidad/bancos-mayor-http";

export async function GET(req: Request, ctx: { params: Promise<{ slug: string; bancoId: string }> }) {
  const { slug, bancoId } = await ctx.params;
  return bancosMayorHttp(req, slug, bancoId);
}
