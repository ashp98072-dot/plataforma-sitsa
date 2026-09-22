import { reqViaticosGet, reqViaticosGuardar } from "@/lib/tms/viaticos-requerimientos-api";
export async function GET(_:Request,{params}:{params:Promise<{slug:string}>}){return reqViaticosGet((await params).slug);}
export async function POST(req:Request,{params}:{params:Promise<{slug:string}>}){return reqViaticosGuardar(req,(await params).slug);}
