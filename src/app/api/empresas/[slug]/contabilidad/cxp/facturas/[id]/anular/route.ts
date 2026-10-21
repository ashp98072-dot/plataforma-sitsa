import { anularFacturaHttp } from "@/lib/contabilidad/cxp/http";
export async function POST(req: Request, ctx: { params: Promise<{ slug: string; id: string }> }) { const { slug, id } = await ctx.params; return anularFacturaHttp(req, slug, id); }
