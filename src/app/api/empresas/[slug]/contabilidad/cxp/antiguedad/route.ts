import { antiguedadCxpHttp } from "@/lib/contabilidad/cxp/http-antiguedad";
export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }) { return antiguedadCxpHttp(req, (await ctx.params).slug); }
