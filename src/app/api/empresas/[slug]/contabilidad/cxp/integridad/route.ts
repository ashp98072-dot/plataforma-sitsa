import { integridadCxpHttp } from "@/lib/contabilidad/cxp/http-integridad";

export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  return integridadCxpHttp(req, (await ctx.params).slug);
}
