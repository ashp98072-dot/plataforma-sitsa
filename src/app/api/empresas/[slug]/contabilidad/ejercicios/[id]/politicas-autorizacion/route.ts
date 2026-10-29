import {politicasAutorizacionHttp} from '@/lib/contabilidad/politicas-autorizacion-http';
type Contexto={params:Promise<{slug:string;id:string}>};
export async function GET(req:Request,{params}:Contexto){const {slug,id}=await params;return politicasAutorizacionHttp(req,slug,id);}
export async function POST(req:Request,{params}:Contexto){const {slug,id}=await params;return politicasAutorizacionHttp(req,slug,id,true);}
