import {expedienteHttp} from '@/lib/contabilidad/expediente-http';
type Contexto={params:Promise<{slug:string;id:string}>};
export async function GET(req:Request,{params}:Contexto){const {slug,id}=await params;return expedienteHttp(req,slug,id);}
export async function POST(req:Request,{params}:Contexto){const {slug,id}=await params;return expedienteHttp(req,slug,id,true);}
