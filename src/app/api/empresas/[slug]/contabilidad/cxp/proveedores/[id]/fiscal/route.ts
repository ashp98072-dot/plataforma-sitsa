import { guardarConfigFiscalHttp, obtenerConfigFiscalHttp } from "@/lib/contabilidad/cxp/http";
type Ctx = { params: Promise<{ slug: string; id: string }> };
export async function GET(req: Request, ctx: Ctx) { const { slug, id } = await ctx.params; return obtenerConfigFiscalHttp(req, slug, id); }
export async function PUT(req: Request, ctx: Ctx) { const { slug, id } = await ctx.params; return guardarConfigFiscalHttp(req, slug, id); }
