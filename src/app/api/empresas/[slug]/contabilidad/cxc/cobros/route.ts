import { listarCobrosHttp, registrarCobroHttp } from "@/lib/contabilidad/cxc/http";
type Ctx = { params: Promise<{ slug: string }> };
export async function GET(req: Request, ctx: Ctx) { return listarCobrosHttp(req, (await ctx.params).slug); }
export async function POST(req: Request, ctx: Ctx) { return registrarCobroHttp(req, (await ctx.params).slug); }
