import {regularizacionGet} from '@/lib/contabilidad/regularizacion-http';
export async function GET(req:Request,{params}:{params:Promise<{slug:string;id:string}>}){const {slug,id}=await params;return regularizacionGet(req,slug,id,true);}
