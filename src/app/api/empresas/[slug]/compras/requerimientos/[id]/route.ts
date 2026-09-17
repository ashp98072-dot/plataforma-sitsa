import { requerimientoGet, requerimientoGuardar } from "@/lib/compras/requerimiento-api";
type Ctx = { params: Promise<{ slug: string; id: string }> };
export async function GET(req: Request, ctx: Ctx) { const { slug, id } = await ctx.params; return requerimientoGet(req, slug, id); }
export async function PATCH(req: Request, ctx: Ctx) { const { slug, id } = await ctx.params; return requerimientoGuardar(req, slug, id); }
