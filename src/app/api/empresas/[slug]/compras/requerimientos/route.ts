import { requerimientoGet, requerimientoGuardar } from "@/lib/compras/requerimiento-api";
type Ctx = { params: Promise<{ slug: string }> };
export async function GET(req: Request, ctx: Ctx) { return requerimientoGet(req, (await ctx.params).slug); }
export async function POST(req: Request, ctx: Ctx) { return requerimientoGuardar(req, (await ctx.params).slug); }
