import { reqViaticosCatalogos } from "@/lib/tms/viaticos-requerimientos-api";
export async function GET(_:Request,{params}:{params:Promise<{slug:string}>}){return reqViaticosCatalogos((await params).slug);}
