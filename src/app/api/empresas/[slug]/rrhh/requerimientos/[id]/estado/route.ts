import { requerimientoRrhhEstadoCambiar } from "@/lib/rrhh/requerimiento-api";
type Ctx = { params: Promise<{ slug: string; id: string }> };
export async function POST(req: Request, ctx: Ctx) { const { slug, id } = await ctx.params; return requerimientoRrhhEstadoCambiar(req, slug, id); }
