import {NextResponse} from 'next/server';
import {ZodError} from 'zod';
import {requireTenantCalendario} from '@/lib/tenant';
import {ambitoDesdeRequest,errorAmbito} from './ambito';
import {consultarExpedientes,registrarEvidencia} from './expediente';

export async function expedienteHttp(req:Request,slug:string,ejercicio:string,escribir=false){
 const headers={'Cache-Control':'private, no-store'};
 const g=await requireTenantCalendario(slug,'ver');
 if(g.error){g.error.headers.set('Cache-Control',headers['Cache-Control']);return g.error;}
 try{
  if(!/^[1-9]\d{0,9}$/.test(ejercicio)||Number(ejercicio)>2147483647)return NextResponse.json({error:'Ejercicio inválido.'},{status:400,headers});
  const a=ambitoDesdeRequest(req,g.session);
  const d=escribir?await registrarEvidencia(g.empresa.id,a.entidadId,Number(ejercicio),{id:g.session.id,username:g.session.username},await req.json().catch(()=>null)):
   await consultarExpedientes(g.empresa.id,a.entidadId,Number(ejercicio),g.session.id);
  return NextResponse.json(d,{headers});
 }catch(e){
  if(e instanceof ZodError)return NextResponse.json({error:'Revisa operación, versión, huellas, responsables y justificación.'},{status:400,headers});
  if(['ER_NO_SUCH_TABLE','ER_BAD_FIELD_ERROR'].includes(String((e as {code?:string}).code)))return NextResponse.json({error:'Esquema C3C-12 o dependencias pendiente. Revisa las migraciones autorizadas.',codigo:'MIGRACION_PENDIENTE'},{status:503,headers});
  const known=errorAmbito(e);if(known){known.headers.set('Cache-Control',headers['Cache-Control']);return known;}
  return NextResponse.json({error:'No se pudo completar el control técnico. No se aprobó ni contabilizó ningún asiento.'},{status:500,headers});
 }
}
