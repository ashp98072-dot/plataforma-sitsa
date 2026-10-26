import { documentoHttp } from "@/lib/flota/cb2/documentos-http";
export const runtime = "nodejs";
type Contexto = { params: Promise<{ slug: string; id: string }> };
export async function GET(req: Request, ctx: Contexto) { const p = await ctx.params; return documentoHttp(req, p.slug, p.id); }
export async function PATCH(req: Request, ctx: Contexto) { const p = await ctx.params; return documentoHttp(req, p.slug, p.id); }
