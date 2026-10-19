import { clientesCobroHttp } from "@/lib/contabilidad/cxc/cobros-http";
export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }) { return clientesCobroHttp(req, (await ctx.params).slug); }
