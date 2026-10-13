import { confirmacionEvidencia } from "@/lib/facturacion/confirmaciones-bancarias-api";
type Ctx = { params: Promise<{ slug:string; id:string; confirmacionId:string }> };
export async function GET(req:Request,ctx:Ctx) { return confirmacionEvidencia(await ctx.params); }
export const runtime = "nodejs";
