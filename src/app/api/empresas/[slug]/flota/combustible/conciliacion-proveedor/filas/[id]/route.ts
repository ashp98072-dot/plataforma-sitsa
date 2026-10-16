import { accionC2cHttp, candidatosC2cHttp } from "@/lib/flota/combustible-c2c-http";
type Ctx = { params: Promise<{ slug: string; id: string }> };
export async function GET(req: Request, ctx: Ctx) { const { slug, id } = await ctx.params; return candidatosC2cHttp(req, slug, id); }
export async function POST(req: Request, ctx: Ctx) { const { slug, id } = await ctx.params; return accionC2cHttp(req, slug, id); }
