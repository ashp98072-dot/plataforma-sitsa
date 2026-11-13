import { z, ZodError } from "zod";
import { NextResponse } from "next/server";
import { requireTenantFlota } from "@/lib/tenant";
import { ErrorCB2 } from "./cb2/model";
import { bodyAcotado } from "./cb2/http";
import { validarOrigenCB2 } from "./cb2/origin";
import { inspeccionarIdentidadFisica, proponerIdentidadFisica, consultarIdentidadFisica, aprobarIdentidadFisica } from "./identidad-fisica";
const id=z.number().int().positive().max(2147483647),revision=z.string().regex(/^[0-9a-f]{64}$/);
const ids=z.array(id).min(2).max(10).refine(a=>new Set(a).size===a.length);
const propuesta=z.object({ids,revisiones:z.record(z.string().regex(/^\d+$/),revision),motivo:z.string().trim().min(10).max(1000),confirmado:z.literal(true)}).strict();
const aprobacion=z.object({id,revision,evidencia:z.string().trim().min(10).max(1000),confirmado:z.literal(true)}).strict();
export async function identidadFisicaHttp(req:Request,slug:string){
 const accion=req.method==='GET'?'ver':req.method==='POST'?'crear':'editar';
 const g=await requireTenantFlota(slug,'flota_vehiculos',accion);
 if(g.error)return g.error;
 if(g.session.rol!=='Admin')return NextResponse.json({error:'Requiere administrador de la empresa.'},{status:403});
 const ctx={empresaId:g.empresa.id,usuarioId:g.session.id,usuario:g.session.username,autorizar:async()=>{const a=await requireTenantFlota(slug,'flota_vehiculos',accion);if(a.error||a.empresa.id!==g.empresa.id||a.session.id!==g.session.id||a.session.rol!=='Admin')throw new ErrorCB2('Permiso revocado.',403);}};
 try{
  let result:unknown;
  if(req.method==='GET'){const url=new URL(req.url);result=url.searchParams.has('vehiculos')?await inspeccionarIdentidadFisica(ctx,ids.parse(url.searchParams.get('vehiculos')!.split(',').map(Number))):await consultarIdentidadFisica(ctx,url.searchParams.has('id')?id.parse(Number(url.searchParams.get('id'))):undefined);}
  else{validarOrigenCB2(req);const data=JSON.parse((await bodyAcotado(req,32768)).toString('utf8'));result=req.method==='POST'?await proponerIdentidadFisica(ctx,propuesta.parse(data)):await aprobarIdentidadFisica(ctx,aprobacion.parse(data));}
  return NextResponse.json(result,{headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
 }catch(e){const status=e instanceof ErrorCB2?e.status:e instanceof ZodError||e instanceof SyntaxError?400:(e as {code?:string}).code==='ER_DUP_ENTRY'?409:503;return NextResponse.json({error:e instanceof ErrorCB2?e.message:status===400?'Solicitud inválida.':status===409?'Registro o aprobación ya propuestos; consulta el estado antes de reintentar.':'No se pudo completar; revisar esquema y privilegios.'},{status,headers:{'Cache-Control':'private, no-store'}});}
}
