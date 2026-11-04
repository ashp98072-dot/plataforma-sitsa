import { estadoCuentaCxpHttp } from "@/lib/contabilidad/cxp/http-estado-cuenta";
export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }) { return estadoCuentaCxpHttp(req, (await ctx.params).slug); }
