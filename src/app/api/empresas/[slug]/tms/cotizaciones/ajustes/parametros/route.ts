import { NextResponse } from "next/server";
import { requireTenantCotizacionesAjustes } from "@/lib/tenant";
import { crearParametrosAjustes, ErrorAjustesCosteo, parametrosAjustesSchema } from "@/lib/tms/cotizacion-costeo-ajustes";
type Ctx={params:Promise<{slug:string}>}; const H={"Cache-Control":"private, no-store"};
export async function POST(req:Request,ctx:Ctx){const {slug}=await ctx.params;const guard=await requireTenantCotizacionesAjustes(slug,"crear");if(guard.error)return guard.error;
  const parsed=parametrosAjustesSchema.safeParse(await req.json().catch(()=>null)); if(!parsed.success)return NextResponse.json({error:parsed.error.issues[0]?.message||"Datos inválidos."},{status:400,headers:H});
  try{const id=await crearParametrosAjustes(guard.empresa.id,guard.session.username,parsed.data);return NextResponse.json({id},{status:201,headers:H});}
  catch(e){if(e instanceof ErrorAjustesCosteo)return NextResponse.json({error:e.message},{status:e.status,headers:H});return NextResponse.json({error:"No se pudo crear la vigencia."},{status:500,headers:H});}}
