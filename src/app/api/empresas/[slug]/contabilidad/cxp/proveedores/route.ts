import { listarProveedoresHttp } from "@/lib/contabilidad/cxp/http";
export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }) { return listarProveedoresHttp(req, (await ctx.params).slug); }
