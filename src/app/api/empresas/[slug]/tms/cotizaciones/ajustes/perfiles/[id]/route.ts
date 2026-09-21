import { NextResponse } from "next/server";
import { requireTenantCotizacionesAjustes } from "@/lib/tenant";
import { actualizarPerfilAjustes, ErrorAjustesCosteo, perfilAjustesActualizarSchema } from "@/lib/tms/cotizacion-costeo-ajustes";
type Ctx={params:Promise<{slug:string;id:string}>};const H={"Cache-Control":"private, no-store"};
export async function PATCH(req:Request,ctx:Ctx){const {slug,id}=await ctx.params;const guard=await requireTenantCotizacionesAjustes(slug,"editar");if(guard.error)return guard.error;const perfilId=Number(id);if(!Number.isInteger(perfilId)||perfilId<=0)return NextResponse.json({error:"Perfil inválido."},{status:400,headers:H});
 const parsed=perfilAjustesActualizarSchema.safeParse(await req.json().catch(()=>null));if(!parsed.success)return NextResponse.json({error:parsed.error.issues[0]?.message||"Datos inválidos."},{status:400,headers:H});
 try{await actualizarPerfilAjustes(guard.empresa.id,perfilId,guard.session.username,parsed.data);return NextResponse.json({ok:true},{headers:H});}
 catch(e){if(e instanceof ErrorAjustesCosteo)return NextResponse.json({error:e.message},{status:e.status,headers:H});return NextResponse.json({error:"No se pudo actualizar el perfil."},{status:500,headers:H});}}
