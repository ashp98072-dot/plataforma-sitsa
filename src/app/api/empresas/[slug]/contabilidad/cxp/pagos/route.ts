import { listarPagosHttp, registrarPagoHttp } from "@/lib/contabilidad/cxp/http";
type Ctx = { params: Promise<{ slug: string }> };
export async function GET(req: Request, ctx: Ctx) { return listarPagosHttp(req, (await ctx.params).slug); }
export async function POST(req: Request, ctx: Ctx) { return registrarPagoHttp(req, (await ctx.params).slug); }
