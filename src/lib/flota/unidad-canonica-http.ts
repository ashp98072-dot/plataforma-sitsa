import { NextResponse } from "next/server";
import { z,ZodError } from "zod";
import { requireTenantFlota } from "@/lib/tenant";
import { getPool } from "@/lib/db";
import { ErrorCB2 } from "./cb2/model";
import { resolverUnidadCanonica,historialUnidadCanonica } from "./unidad-canonica";
export async function unidadCanonicaHttp(req:Request,slug:string){
 const g=await requireTenantFlota(slug,"flota_vehiculos","ver");if(g.error)return g.error;
 const headers={"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"};
 try{
  const q=new URL(req.url).searchParams;
  const id=z.coerce.number().int().positive().max(2147483647).parse(q.get('id'));
  const fuente=z.string().regex(/^[a-zA-Z0-9_]+$/).optional().parse(q.get('fuente')??undefined),despues=z.coerce.number().int().min(0).max(2147483647).parse(q.get('despues')??0);
  const historial=q.get('historial')==='1';if(historial&&g.session.rol!=='Admin')throw new ErrorCB2("El inventario completo de referencias requiere revisión administrativa.",403);
  const c=await getPool().getConnection();try{await c.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");await c.beginTransaction();const data=historial?await historialUnidadCanonica(c,g.empresa.id,id,fuente,despues):await resolverUnidadCanonica(c,g.empresa.id,id);await c.commit();return NextResponse.json(data,{headers});}catch(e){await c.rollback();throw e;}finally{c.release();}
 }catch(e){return NextResponse.json({error:e instanceof ErrorCB2?e.message:e instanceof ZodError?"Parámetros inválidos.":"No se pudo resolver la unidad; revisar preflight."},{status:e instanceof ErrorCB2?e.status:e instanceof ZodError?400:503,headers});}
}
