import { confirmacionAnular } from "@/lib/facturacion/confirmaciones-bancarias-api";
type Ctx = { params: Promise<{ slug:string; id:string; confirmacionId:string }> };
export async function POST(req:Request,ctx:Ctx) { return confirmacionAnular(req,await ctx.params); }
export const runtime = "nodejs";
