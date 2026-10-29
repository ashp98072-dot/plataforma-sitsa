import {cuentaResultadoHttp} from '@/lib/contabilidad/cuenta-resultado-http';
type Contexto={params:Promise<{slug:string}>};
export async function GET(req:Request,{params}:Contexto){return cuentaResultadoHttp(req,(await params).slug);}
export async function PUT(req:Request,{params}:Contexto){return cuentaResultadoHttp(req,(await params).slug,true);}
