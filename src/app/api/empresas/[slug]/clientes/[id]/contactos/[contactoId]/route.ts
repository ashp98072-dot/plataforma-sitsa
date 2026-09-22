import { NextResponse } from "next/server";
import { z } from "zod";
import { requireClientesOFacturacion } from "@/lib/clientes/acceso";
import { resolverTmsClienteId } from "@/lib/clientes/repository";
import { registrarAuditoria } from "@/lib/auditoria";
import { actualizarContactoCliente, eliminarContactoClienteSinUso, obtenerContacto } from "@/lib/tms/cliente-contactos";

type Ctx = { params: Promise<{ slug: string; id: string; contactoId: string }> };
const schema = z.object({ nombre:z.string().trim().min(1).max(160).optional(), cargo:z.string().trim().max(120).nullable().optional(), telefono:z.string().trim().max(80).nullable().optional(), email:z.string().trim().email().max(160).or(z.literal("")).nullable().optional(), observaciones:z.string().trim().max(300).nullable().optional(), activo:z.boolean().optional() }).strict();

async function resolver(slug:string,id:string,contactoId:string){
  const guard=await requireClientesOFacturacion(slug,"clientes",true);if(guard.error)return{error:guard.error}as const;
  const clienteId=Number(id),cid=Number(contactoId);if(!Number.isInteger(clienteId)||!Number.isInteger(cid))return{error:NextResponse.json({error:"ID inválido."},{status:400})}as const;
  const resolucion=await resolverTmsClienteId(guard.empresa.id,clienteId);if(!resolucion.ok)return{error:NextResponse.json({error:resolucion.mensaje},{status:404})}as const;
  const actual=await obtenerContacto(guard.empresa.id,cid);if(!actual||actual.clienteId!==resolucion.tmsClienteId)return{error:NextResponse.json({error:"Contacto no encontrado."},{status:404})}as const;
  return{guard,clienteId,cid,resolucion,actual}as const;
}

export async function PATCH(req:Request,ctx:Ctx){const p=await ctx.params;const r=await resolver(p.slug,p.id,p.contactoId);if("error"in r)return r.error;const parsed=schema.safeParse(await req.json().catch(()=>({})));if(!parsed.success)return NextResponse.json({error:parsed.error.issues[0]?.message??"Datos inválidos."},{status:400});const contacto=await actualizarContactoCliente(r.guard.empresa.id,r.cid,parsed.data);await registrarAuditoria({empresaId:r.guard.empresa.id,usuario:r.guard.session.username,accion:parsed.data.activo===false?"desactivar_contacto_cliente":parsed.data.activo===true?"reactivar_contacto_cliente":"editar_contacto_cliente",modulo:"clientes",detalle:`Contacto #${r.cid} del cliente #${r.clienteId}.`});return NextResponse.json({contacto,mensaje:"Contacto actualizado."});}

export async function DELETE(_req:Request,ctx:Ctx){const p=await ctx.params;const r=await resolver(p.slug,p.id,p.contactoId);if("error"in r)return r.error;const resultado=await eliminarContactoClienteSinUso(r.guard.empresa.id,r.resolucion.tmsClienteId,r.cid);if(!resultado.ok)return NextResponse.json({error:resultado.motivo==="UTILIZADO"?"Este contacto ya fue utilizado en operaciones y no puede eliminarse. Puedes desactivarlo para que deje de aparecer en nuevas operaciones.":"Contacto no encontrado."},{status:resultado.motivo==="UTILIZADO"?409:404});await registrarAuditoria({empresaId:r.guard.empresa.id,usuario:r.guard.session.username,accion:"eliminar_contacto_cliente",modulo:"clientes",detalle:`Contacto #${r.cid} sin uso eliminado del cliente #${r.clienteId}.`});return NextResponse.json({mensaje:"Contacto eliminado."});}
