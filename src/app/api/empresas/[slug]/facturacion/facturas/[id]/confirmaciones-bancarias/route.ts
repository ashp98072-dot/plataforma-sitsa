import { confirmacionesGet, confirmacionesPost } from "@/lib/facturacion/confirmaciones-bancarias-api";
type Ctx = { params: Promise<{ slug:string; id:string }> };
export async function GET(_req:Request,ctx:Ctx) { return confirmacionesGet(await ctx.params); }
export async function POST(req:Request,ctx:Ctx) { return confirmacionesPost(req,await ctx.params); }
export const runtime = "nodejs";
