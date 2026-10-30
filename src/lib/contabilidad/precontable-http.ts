import {NextResponse} from 'next/server';
import {ZodError} from 'zod';
import {requireTenantCalendario} from '@/lib/tenant';
import {ambitoDesdeRequest,errorAmbito} from './ambito';
import {consultarPrecontable,registrarConstancia} from './precontable';
import {precontableAExcel} from './precontable-excel';

export async function precontableHttp(req:Request,slug:string,ejercicio:string,escribir=false){
 const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
 const g=await requireTenantCalendario(slug,'ver');
 if(g.error){Object.entries(headers).forEach(([k,v])=>g.error.headers.set(k,v));return g.error;}
 try{
  if(!/^[1-9]\d{0,9}$/.test(ejercicio)||Number(ejercicio)>2147483647)return NextResponse.json({error:'Ejercicio inválido.'},{status:400,headers});
  const a=ambitoDesdeRequest(req,g.session),q=new URL(req.url).searchParams;
  if(escribir)return NextResponse.json(await registrarConstancia(g.empresa.id,a.entidadId,Number(ejercicio),{id:g.session.id,username:g.session.username},await req.json().catch(()=>null)),{headers});
  const formato=q.get('formato');
  if(q.getAll('formato').length>1||(formato&&formato!=='xlsx'))return NextResponse.json({error:'Formato inválido.'},{status:400,headers});
  const solicitud=q.get('solicitud');
  if(formato&&(!solicitud||!/^[1-9]\d{0,18}$/.test(solicitud)||q.getAll('solicitud').length!==1))return NextResponse.json({error:'Selecciona una solicitud.'},{status:400,headers});
  const d=await consultarPrecontable(g.empresa.id,a.entidadId,Number(ejercicio),g.session.id);
  if(formato==='xlsx'){
   const e=d.evaluaciones.find(e=>e.informe.solicitudId===solicitud);
   if(!e)return NextResponse.json({error:'Solicitud no disponible en este ámbito.'},{status:404,headers});
   const bytes=await precontableAExcel(e.informe);
   return new Response(new Uint8Array(bytes),{headers:{...headers,'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':`attachment; filename="precontable-${solicitud}.xlsx"`}});
  }
  return NextResponse.json(d,{headers});
 }catch(e){
  if(e instanceof ZodError)return NextResponse.json({error:'Revisa solicitud, versión, huella, confirmación y justificación.'},{status:400,headers});
  if(['ER_NO_SUCH_TABLE','ER_BAD_FIELD_ERROR'].includes(String((e as {code?:string}).code)))return NextResponse.json({error:'Esquema C3C-13 o dependencias pendiente.',codigo:'MIGRACION_PENDIENTE'},{status:503,headers});
  const known=errorAmbito(e);if(known){Object.entries(headers).forEach(([k,v])=>known.headers.set(k,v));return known;}
  return NextResponse.json({error:'No se pudo evaluar el expediente. Sin aprobación ni contabilización.'},{status:500,headers});
 }
}
