import { reporteHttp } from "@/lib/contabilidad/reportes/http";
export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }) { return reporteHttp(req, (await ctx.params).slug, "mayor"); }
