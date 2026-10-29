import {diagnosticoCierreGet} from '@/lib/contabilidad/cierre-diagnostico-http';
export async function GET(req:Request,{params}:{params:Promise<{slug:string;id:string}>}){const {slug,id}=await params;return diagnosticoCierreGet(req,slug,id);}
