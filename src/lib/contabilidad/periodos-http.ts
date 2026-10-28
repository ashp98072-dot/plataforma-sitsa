import {NextResponse} from 'next/server';
import {randomUUID} from 'node:crypto';
import {ZodError} from 'zod';
import {requireTenantCalendario} from '@/lib/tenant';
import {ambitoDesdeRequest,errorAmbito} from './ambito';
import {operarPeriodo,consultarControlPeriodo,consultarEvidenciaPeriodo} from './periodos';

export async function controlPeriodosHttp(req:Request,slug:string,write=false){
  const guard=await requireTenantCalendario(slug,'ver');if(guard.error)return guard.error;
  try{
    const ambito=ambitoDesdeRequest(req,guard.session);
    const cierres=new URL(req.url).searchParams.getAll('cierre');
    if(cierres.length>1||cierres.length&&(!/^[1-9]\d{0,9}$/.test(cierres[0])||Number(cierres[0])>2147483647))return NextResponse.json({error:'Identificador de cierre inválido.'},{status:400});
    const result=write?await operarPeriodo({empresaId:guard.empresa.id,entidadId:ambito.entidadId,actor:{id:guard.session.id,username:guard.session.username}},await req.json().catch(()=>null)):
      cierres.length?await consultarEvidenciaPeriodo(guard.empresa.id,ambito.entidadId,Number(cierres[0])):await consultarControlPeriodo(guard.empresa.id,ambito.entidadId,guard.session.id);
    return NextResponse.json(result,{headers:{'Cache-Control':'private, no-store'}});
  }catch(error){
    if(error instanceof ZodError)return NextResponse.json({error:'Solicitud inválida: revisa motivo, identificadores y versión.'},{status:400});
    const known=errorAmbito(error);if(known){known.headers.set('Cache-Control','private, no-store');return known;}
    const referencia=randomUUID();console.error('periodos_error',{referencia});
    return NextResponse.json({error:'No se confirmó la operación. Consulta el historial antes de repetir.',referencia},{status:500,headers:{'Cache-Control':'private, no-store'}});
  }
}
