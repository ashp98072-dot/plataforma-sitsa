import { cb2Http } from "@/lib/flota/cb2/http";
export async function GET(req:Request,{params}:{params:Promise<{slug:string;id:string}>}){const p=await params;return cb2Http(req,p.slug,"pilotos-nombres",p.id);}
