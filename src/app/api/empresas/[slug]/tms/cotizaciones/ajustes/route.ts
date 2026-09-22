import { NextResponse } from "next/server";
import { requireTenantCotizacionesAjustes } from "@/lib/tenant";
import { hoyGuatemala, listarParametrosAjustes, listarPerfilesAjustes } from "@/lib/tms/cotizacion-costeo-ajustes";
import { obtenerPresentacionComercial } from "@/lib/tms/cotizacion-presentacion";
type Ctx={params:Promise<{slug:string}>};
const H={"Cache-Control":"private, no-store"};
export async function GET(_req:Request,ctx:Ctx){
  const {slug}=await ctx.params; const guard=await requireTenantCotizacionesAjustes(slug,"ver");
  if(guard.error){guard.error.headers.set("Cache-Control","private, no-store");return guard.error;}
  try {
    const hoy=hoyGuatemala();
    // presentacion (mensaje/cierre predeterminados por marca) nunca falla el resto de la pantalla:
    // obtenerPresentacionComercial ya cae a su fallback fijo por marca si `configuracion` no existe.
    const [parametros,perfiles,presentacion]=await Promise.all([
      listarParametrosAjustes(guard.empresa.id,hoy),
      listarPerfilesAjustes(guard.empresa.id),
      obtenerPresentacionComercial(guard.empresa.id),
    ]);
    return NextResponse.json({hoy,parametros,perfiles,presentacion},{headers:H});
  } catch { return NextResponse.json({error:"No se pudieron cargar los ajustes de costeo."},{status:500,headers:H}); }
}
