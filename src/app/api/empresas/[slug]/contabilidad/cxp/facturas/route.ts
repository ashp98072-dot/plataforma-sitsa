import { listarFacturasHttp, registrarFacturaHttp } from "@/lib/contabilidad/cxp/http";
type Ctx = { params: Promise<{ slug: string }> };
export async function GET(req: Request, ctx: Ctx) { return listarFacturasHttp(req, (await ctx.params).slug); }
export async function POST(req: Request, ctx: Ctx) { return registrarFacturaHttp(req, (await ctx.params).slug); }
