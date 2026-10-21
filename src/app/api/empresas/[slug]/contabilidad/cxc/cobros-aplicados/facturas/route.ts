import { facturasPendientesHttp } from "@/lib/contabilidad/cxc/cobros-http";
export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }) { return facturasPendientesHttp(req, (await ctx.params).slug); }
