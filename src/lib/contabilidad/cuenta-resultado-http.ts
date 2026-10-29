import {NextResponse} from 'next/server';
import {z} from 'zod';
import {requireTenantCalendario} from '@/lib/tenant';
import {ambitoDesdeRequest,errorAmbito} from './ambito';
import {consultarConfiguracionResultado,guardarCuentaResultado} from './cuenta-resultado';
const id=z.number().int().positive().max(2147483647);
const entrada=z.strictObject({cuentaId:id,cuentaAnteriorId:id.nullable()});
export async function cuentaResultadoHttp(req:Request,slug:string,guardar=false){
 const g=await requireTenantCalendario(slug,'ver');const headers={'Cache-Control':'private, no-store'};if(g.error)return g.error;
 try{const a=ambitoDesdeRequest(req,g.session);
  if(!guardar)return NextResponse.json(await consultarConfiguracionResultado(g.empresa.id,a.entidadId,g.session.id),{headers});
  const d=entrada.parse(await req.json().catch(()=>null));return NextResponse.json(await guardarCuentaResultado(g.empresa.id,a.entidadId,{id:g.session.id,username:g.session.username},d.cuentaId,d.cuentaAnteriorId),{headers});
 }catch(e){if(e instanceof z.ZodError)return NextResponse.json({error:'Revisa la cuenta y la versión consultada.'},{status:400,headers});const known=errorAmbito(e);if(known)return known;
  if((e as {code?:string}).code==='ER_CONSTRAINT_FAILED')return NextResponse.json({error:'Rol no admitido por el esquema. Revisa la migración C3C-7.'},{status:503,headers});
  return NextResponse.json({error:'No se pudo guardar o consultar la configuración.'},{status:500,headers});}
}
