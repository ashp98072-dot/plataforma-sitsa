import { importarCombustibleHttp } from "@/lib/flota/combustible-importaciones-http";
export async function POST(req: Request, ctx: { params: Promise<{ slug: string }> }) { return importarCombustibleHttp(req, (await ctx.params).slug, false); }
