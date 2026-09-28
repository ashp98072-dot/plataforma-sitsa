import { requerimientoRrhhCatalogosGet } from "@/lib/rrhh/requerimiento-api";
type Ctx = { params: Promise<{ slug: string }> };
export async function GET(_req: Request, ctx: Ctx) { return requerimientoRrhhCatalogosGet((await ctx.params).slug); }
