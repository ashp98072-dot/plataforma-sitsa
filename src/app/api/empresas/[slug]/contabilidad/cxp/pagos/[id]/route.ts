import { obtenerPagoHttp } from "@/lib/contabilidad/cxp/http";
export async function GET(req: Request, ctx: { params: Promise<{ slug: string; id: string }> }) { const { slug, id } = await ctx.params; return obtenerPagoHttp(req, slug, id); }
