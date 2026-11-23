import { pilotosEquivalenciasHttp } from "@/lib/flota/cb2/pilotos-equivalencias-http";
export const runtime = "nodejs";
export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }) { return pilotosEquivalenciasHttp(req, (await ctx.params).slug); }
export async function POST(req: Request, ctx: { params: Promise<{ slug: string }> }) { return pilotosEquivalenciasHttp(req, (await ctx.params).slug); }
