import { valesSinReporteHttp } from "@/lib/flota/combustible-c2c-http";
export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }) { const { slug } = await ctx.params; return valesSinReporteHttp(req, slug); }
