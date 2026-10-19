import { listarBitacoraCxpHttp } from "@/lib/contabilidad/cxp/http";
export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }) { return listarBitacoraCxpHttp(req, (await ctx.params).slug); }
