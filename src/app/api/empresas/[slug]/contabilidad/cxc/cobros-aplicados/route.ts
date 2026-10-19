import { listarCobrosAplicadosHttp, registrarCobroAplicadoHttp } from "@/lib/contabilidad/cxc/cobros-http";
type Ctx = { params: Promise<{ slug: string }> };
export async function GET(req: Request, ctx: Ctx) { return listarCobrosAplicadosHttp(req, (await ctx.params).slug); }
export async function POST(req: Request, ctx: Ctx) { return registrarCobroAplicadoHttp(req, (await ctx.params).slug); }
