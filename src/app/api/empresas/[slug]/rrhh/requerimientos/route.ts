import { requerimientoRrhhGet, requerimientoRrhhGuardar } from "@/lib/rrhh/requerimiento-api";
type Ctx = { params: Promise<{ slug: string }> };
export async function GET(req: Request, ctx: Ctx) { return requerimientoRrhhGet(req, (await ctx.params).slug); }
export async function POST(req: Request, ctx: Ctx) { return requerimientoRrhhGuardar(req, (await ctx.params).slug); }
