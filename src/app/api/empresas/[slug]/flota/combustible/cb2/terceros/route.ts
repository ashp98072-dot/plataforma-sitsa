import { tercerosHttp } from "@/lib/flota/cb2/terceros-http";
type Contexto = { params: Promise<{ slug: string }> };
export async function GET(req: Request, ctx: Contexto) { return tercerosHttp(req, (await ctx.params).slug); }
export async function POST(req: Request, ctx: Contexto) { return tercerosHttp(req, (await ctx.params).slug); }
export async function PATCH(req: Request, ctx: Contexto) { return tercerosHttp(req, (await ctx.params).slug); }
