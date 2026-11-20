import { perfilCreditoHttp } from '@/lib/facturacion/credito-http';
type Ctx = { params: Promise<{ slug: string; id: string }> };
export async function GET(req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  return perfilCreditoHttp(req, slug, id, false);
}
export async function PUT(req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  return perfilCreditoHttp(req, slug, id, true);
}
