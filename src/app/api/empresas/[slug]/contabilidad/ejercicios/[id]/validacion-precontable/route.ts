import {precontableHttp} from '@/lib/contabilidad/precontable-http';
type Contexto={params:Promise<{slug:string;id:string}>};
export async function GET(req:Request,{params}:Contexto){const {slug,id}=await params;return precontableHttp(req,slug,id);}
export async function POST(req:Request,{params}:Contexto){const {slug,id}=await params;return precontableHttp(req,slug,id,true);}
