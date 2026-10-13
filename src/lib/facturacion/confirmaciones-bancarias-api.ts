import { NextResponse } from "next/server";
import { readFile, unlink } from "fs/promises";
import { createHash } from "crypto";
import { requireTenantFacturacion } from "@/lib/tenant";
import { guardarUpload, validarRutaArchivoEmpresa } from "@/lib/uploads";
import { confirmacionBancariaSchema, anulacionBancariaSchema } from "./confirmacion-bancaria-schema";
import { validarEvidenciaBancaria, MAX_EVIDENCIA_BANCARIA } from "./confirmacion-bancaria-evidencia";
import { confirmarIngresoBancario, anularConfirmacionBancaria, listarConfirmacionesBancarias, evidenciaConfirmacionBancaria, ErrorConfirmacionBancaria, type EvidenciaBancaria } from "./confirmaciones-bancarias";

type Params = { slug: string; id: string; confirmacionId?: string };
const headers = { "Cache-Control": "private, no-store" };
function id(s?: string) { return s && /^\d+$/.test(s) && Number.isSafeInteger(Number(s)) && Number(s)>0 ? Number(s) : null; }
export function errorBancario(e: unknown) {
  if (e instanceof ErrorConfirmacionBancaria) return NextResponse.json({ error: e.message }, { status: e.status, headers });
  const code = (e as { code?: string })?.code;
  if (code === "ER_NO_SUCH_TABLE" || code === "ER_BAD_FIELD_ERROR") return NextResponse.json({ error: "Falta aplicar la migración de confirmaciones bancarias." }, { status: 503, headers });
  if (code === "ER_DUP_ENTRY") return NextResponse.json({ error: "La clave de idempotencia ya está registrada. Reintenta con los mismos datos." }, { status: 409, headers });
  console.error("[confirmaciones-bancarias] error interno", code ?? "sin código");
  return NextResponse.json({ error: "No se pudo completar la operación bancaria." }, { status: 500, headers });
}
export async function confirmacionesGet(p: Params) {
  const g = await requireTenantFacturacion(p.slug,"ver_confirmaciones_bancarias"); if (g.error) return g.error;
  const facturaId=id(p.id); if (!facturaId) return NextResponse.json({ error:"ID inválido." },{status:400});
  try { return NextResponse.json(await listarConfirmacionesBancarias(g.empresa.id,facturaId),{headers}); } catch(e) { return errorBancario(e); }
}
export async function confirmacionesPost(req: Request,p: Params) {
  const g=await requireTenantFacturacion(p.slug,"confirmar_banco"); if(g.error) return g.error;
  const facturaId=id(p.id); if(!facturaId) return NextResponse.json({error:"ID inválido."},{status:400});
  let evidencia: EvidenciaBancaria|null=null;
  let conservar=false;
  try {
    // multipart materializa memoria: límite de transporte antes de parsear cuando esté disponible.
    const longitud=Number(req.headers.get("content-length"));
    if (longitud>MAX_EVIDENCIA_BANCARIA+65536) throw new ErrorConfirmacionBancaria("La solicitud supera el máximo permitido.",413);
    let raw: unknown; let archivo: File|null=null;
    if(req.headers.get("content-type")?.includes("multipart/form-data")) {
      const form=await req.formData();
      try { raw=JSON.parse(String(form.get("datos"))); } catch { throw new ErrorConfirmacionBancaria("Datos inválidos.",400); }
      const a=form.get("evidencia"); if(a instanceof File && a.size>0) archivo=a;
    } else raw=await req.json().catch(()=>null);
    const parsed=confirmacionBancariaSchema.safeParse(raw);
    if(!parsed.success) throw new ErrorConfirmacionBancaria("Datos de confirmación inválidos: "+parsed.error.issues.map(i=>i.path.join(".")).join(", "),400);
    if(archivo) {
      if(archivo.size>MAX_EVIDENCIA_BANCARIA) throw new ErrorConfirmacionBancaria("La evidencia supera 10 MB.",413);
      const buffer=Buffer.from(await archivo.arrayBuffer());
      let metadata; try { metadata=validarEvidenciaBancaria(buffer,archivo.name,archivo.type); } catch(e) { throw new ErrorConfirmacionBancaria((e as Error).message,400); }
      const upload=await guardarUpload(g.empresa.id,"evidencias","confirmacion-bancaria",archivo);
      evidencia={ruta:upload.relative,nombre:upload.original,...metadata};
    }
    // Ante un fallo de red durante COMMIT no borrar una evidencia posiblemente ya vinculada.
    conservar=true;
    const resultado=await confirmarIngresoBancario({empresaId:g.empresa.id,usuarioId:g.session.id,usuario:g.session.username},facturaId,parsed.data,evidencia);
    conservar=!resultado.idempotente;
    return NextResponse.json(resultado,{status:resultado.idempotente?200:201,headers});
  } catch(e) { return errorBancario(e); }
  finally {
    if(evidencia && !conservar) {
      const ruta=validarRutaArchivoEmpresa(g.empresa.id,evidencia.ruta);
      if(ruta) await unlink(ruta).catch(()=>console.error("[confirmaciones-bancarias] archivo temporal pendiente de limpieza"));
    }
  }
}
export async function confirmacionAnular(req:Request,p:Params) {
  const g=await requireTenantFacturacion(p.slug,"anular_confirmacion"); if(g.error) return g.error;
  const facturaId=id(p.id),confirmacionId=id(p.confirmacionId);
  if(!facturaId||!confirmacionId) return NextResponse.json({error:"ID inválido."},{status:400});
  const parsed=anulacionBancariaSchema.safeParse(await req.json().catch(()=>null));
  if(!parsed.success) return NextResponse.json({error:"Motivo de anulación obligatorio."},{status:400});
  try { return NextResponse.json(await anularConfirmacionBancaria({empresaId:g.empresa.id,usuarioId:g.session.id,usuario:g.session.username},facturaId,confirmacionId,parsed.data.motivo),{headers}); } catch(e) {return errorBancario(e);}
}
export async function confirmacionEvidencia(p:Params) {
  const g=await requireTenantFacturacion(p.slug,"ver_confirmaciones_bancarias"); if(g.error) return g.error;
  const facturaId=id(p.id),confirmacionId=id(p.confirmacionId);
  if(!facturaId||!confirmacionId) return NextResponse.json({error:"ID inválido."},{status:400});
  try {
    const e=await evidenciaConfirmacionBancaria(g.empresa.id,facturaId,confirmacionId);
    const ruta=validarRutaArchivoEmpresa(g.empresa.id,e.evidencia_ruta);
    if(!ruta) throw new ErrorConfirmacionBancaria("Evidencia no encontrada.",404);
    const buffer=await readFile(ruta);
    if(createHash("sha256").update(buffer).digest("hex")!==e.evidencia_sha256) throw new ErrorConfirmacionBancaria("La integridad de la evidencia no pudo verificarse.",409);
    const mime=String(e.evidencia_mime);
    if(!["application/pdf","image/png","image/jpeg"].includes(mime)) throw new ErrorConfirmacionBancaria("Formato de evidencia inválido.",409);
    return new Response(new Uint8Array(buffer),{headers:{...headers,"Content-Type":mime,"Content-Disposition":"attachment; filename=\"evidencia-bancaria\"","X-Content-Type-Options":"nosniff","Content-Security-Policy":"sandbox"}});
  } catch(e) {return errorBancario(e);}
}
