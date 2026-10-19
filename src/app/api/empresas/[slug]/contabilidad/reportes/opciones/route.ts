import { opcionesHttp } from "@/lib/contabilidad/reportes/http";
export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }) { return opcionesHttp(req, (await ctx.params).slug); }
