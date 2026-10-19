import { anularCobroAplicadoHttp } from "@/lib/contabilidad/cxc/cobros-http";
export async function POST(req: Request, ctx: { params: Promise<{ slug: string; id: string }> }) { const p = await ctx.params; return anularCobroAplicadoHttp(req, p.slug, p.id); }
