import { duplicadosHttp } from "@/lib/flota/vehiculos-duplicados-http";
type Ctx = { params: Promise<{ slug: string }> };
export async function GET(req: Request, ctx: Ctx) { return duplicadosHttp(req, (await ctx.params).slug); }
export async function POST(req: Request, ctx: Ctx) { return duplicadosHttp(req, (await ctx.params).slug); }
