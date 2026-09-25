import { facturaVerificarGet } from "@/lib/compras/requerimiento-api";
type Ctx = { params: Promise<{ slug: string }> };
export async function GET(req: Request, ctx: Ctx) { return facturaVerificarGet(req, (await ctx.params).slug); }
