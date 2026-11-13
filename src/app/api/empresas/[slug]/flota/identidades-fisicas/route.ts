import { identidadFisicaHttp } from "@/lib/flota/identidad-fisica-http";
type Contexto={params:Promise<{slug:string}>};
async function handle(req:Request,ctx:Contexto){return identidadFisicaHttp(req,(await ctx.params).slug);}
export const GET=handle;
export const POST=handle;
export const PATCH=handle;
