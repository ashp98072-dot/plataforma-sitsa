import {preparacionHttp} from '@/lib/contabilidad/regularizacion-control-http';
export async function GET(req:Request,{params}:{params:Promise<{slug:string;id:string}>}){const {slug,id}=await params;return preparacionHttp(req,slug,id);}
export async function POST(req:Request,{params}:{params:Promise<{slug:string;id:string}>}){const {slug,id}=await params;return preparacionHttp(req,slug,id,true);}
