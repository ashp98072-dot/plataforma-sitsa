import { estacionGuardar, estacionesGet } from "@/lib/flota/combustible-estaciones-http";
type Ctx = { params: Promise<{ slug: string }> };
export async function GET(req: Request, ctx: Ctx) { return estacionesGet(req, (await ctx.params).slug); }
export async function POST(req: Request, ctx: Ctx) { return estacionGuardar(req, (await ctx.params).slug); }
