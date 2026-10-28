import {controlPeriodosHttp} from '@/lib/contabilidad/periodos-http';
type Ctx={params:Promise<{slug:string}>};
export async function GET(req:Request,ctx:Ctx){return controlPeriodosHttp(req,(await ctx.params).slug);}
export async function POST(req:Request,ctx:Ctx){return controlPeriodosHttp(req,(await ctx.params).slug,true);}
