import { reqViaticosTransicion } from "@/lib/tms/viaticos-requerimientos-api";
export async function POST(req:Request,{params}:{params:Promise<{slug:string;id:string}>}){const p=await params;return reqViaticosTransicion(req,p.slug,p.id);}
