import { listarDocumentosHttp } from "@/lib/contabilidad/cxc/http";
export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }) { return listarDocumentosHttp(req, (await ctx.params).slug); }
