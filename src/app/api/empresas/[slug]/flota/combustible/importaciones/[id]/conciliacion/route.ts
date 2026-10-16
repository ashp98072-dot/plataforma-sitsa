import { listarC2cHttp, recalcularC2cHttp } from "@/lib/flota/combustible-c2c-http";
type Ctx = { params: Promise<{ slug: string; id: string }> };
export async function GET(req: Request, ctx: Ctx) { const { slug, id } = await ctx.params; return listarC2cHttp(req, slug, id); }
export async function POST(_req: Request, ctx: Ctx) { const { slug, id } = await ctx.params; return recalcularC2cHttp(slug, id); }
