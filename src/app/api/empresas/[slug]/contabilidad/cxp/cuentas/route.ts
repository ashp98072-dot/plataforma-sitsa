import { listarCuentasHttp } from "@/lib/contabilidad/cxp/http";
export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }) { return listarCuentasHttp(req, (await ctx.params).slug); }
