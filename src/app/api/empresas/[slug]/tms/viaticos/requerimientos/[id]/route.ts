import { reqViaticosGet, reqViaticosGuardar } from "@/lib/tms/viaticos-requerimientos-api";
export async function GET(_:Request,{params}:{params:Promise<{slug:string;id:string}>}){const p=await params;return reqViaticosGet(p.slug,p.id);}
export async function PATCH(req:Request,{params}:{params:Promise<{slug:string;id:string}>}){const p=await params;return reqViaticosGuardar(req,p.slug,p.id);}
