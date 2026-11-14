import { unidadCanonicaHttp } from "@/lib/flota/unidad-canonica-http";
export const runtime="nodejs";
export async function GET(req:Request,ctx:{params:Promise<{slug:string}>}){return unidadCanonicaHttp(req,(await ctx.params).slug);}
