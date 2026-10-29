import {NextResponse} from 'next/server';
import {requireTenantCalendario} from '@/lib/tenant';
import {ambitoDesdeRequest,errorAmbito} from './ambito';
import {simularRegularizacion} from './regularizacion';
export async function regularizacionGet(req:Request,slug:string,ejercicio:string){
 const headers={'Cache-Control':'private, no-store'};
 const g=await requireTenantCalendario(slug,'ver');if(g.error){g.error.headers.set('Cache-Control','private, no-store');return g.error;}
 try{
  if(!/^[1-9]\d{0,9}$/.test(ejercicio)||Number(ejercicio)>2147483647)return NextResponse.json({error:'Ejercicio inválido.'},{status:400,headers});
  const a=ambitoDesdeRequest(req,g.session);
  return NextResponse.json(await simularRegularizacion(g.empresa.id,a.entidadId,Number(ejercicio)),{headers});
 }catch(e){const known=errorAmbito(e);if(known){known.headers.set('Cache-Control','private, no-store');return known;}
  return NextResponse.json({error:'No se pudo completar la simulación. Reintenta la consulta.'},{status:500,headers});}
}
