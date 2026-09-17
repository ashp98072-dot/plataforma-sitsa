import { comprasCatalogosGet } from "@/lib/compras/requerimiento-api";
export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) { return comprasCatalogosGet((await ctx.params).slug); }
