import {revisarOrigen} from './origen-revisiones';
import {NextResponse} from 'next/server';
import {ZodError} from 'zod';
import {requireTenantCalendario} from '@/lib/tenant';
import {ambitoDesdeRequest,errorAmbito} from './ambito';
import {consultarPreparacion,guardarPreparacion,registrarOrigenDocumentado} from './regularizacion-control';
export async function preparacionHttp(req:Request,slug:string,ejercicio:string,guardar=false,origen=false,revision=false){
 const headers={'Cache-Control':'private, no-store'};
 const g=await requireTenantCalendario(slug,'ver');if(g.error){g.error.headers.set('Cache-Control','private, no-store');return g.error;}
 try{
  if(!/^[1-9]\d{0,9}$/.test(ejercicio)||Number(ejercicio)>2147483647)return NextResponse.json({error:'Ejercicio inválido.'},{status:400,headers});
  const a=ambitoDesdeRequest(req,g.session);
  const result=guardar?await (revision?revisarOrigen:origen?registrarOrigenDocumentado:guardarPreparacion)(g.empresa.id,a.entidadId,Number(ejercicio),{id:g.session.id,username:g.session.username},await req.json().catch(()=>null)):await consultarPreparacion(g.empresa.id,a.entidadId,Number(ejercicio),g.session.id);
  return NextResponse.json(result,{headers});
 }catch(e){if(e instanceof ZodError)return NextResponse.json({error:'Revisa huella, revisión, clave, nota y evidencia documental.'},{status:400,headers});if(['ER_NO_SUCH_TABLE','ER_BAD_FIELD_ERROR'].includes(String((e as {code?:string}).code)))return NextResponse.json({error:'Esquema de preparación C3C-9/C3C-10 o dependencias pendientes. Revisa las migraciones autorizadas.',codigo:'MIGRACION_PENDIENTE'},{status:503,headers});const known=errorAmbito(e);if(known){known.headers.set('Cache-Control','private, no-store');return known;}return NextResponse.json({error:'No se pudo consultar o preparar el borrador. No se contabilizó ningún asiento.'},{status:500,headers});}
}
