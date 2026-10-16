import { previsualizarFacturaHttp } from "@/lib/contabilidad/cxp/http";
export async function POST(req: Request, ctx: { params: Promise<{ slug: string }> }) { return previsualizarFacturaHttp(req, (await ctx.params).slug); }
