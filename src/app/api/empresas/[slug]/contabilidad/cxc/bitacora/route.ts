import { listarBitacoraHttp } from "@/lib/contabilidad/cxc/http";
export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }) { return listarBitacoraHttp(req, (await ctx.params).slug); }
