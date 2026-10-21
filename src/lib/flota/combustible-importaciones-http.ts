import { NextResponse } from "next/server";
import { requireTenantFlotaCombustible } from "@/lib/tenant";
import { ErrorDominioFormulario } from "@/lib/validacion-formulario";
import { UploadValidationError } from "@/lib/uploads";
import { validarArchivoImportacion, ErrorArchivoProveedor } from "./combustible-importacion-parser";
import { confirmarImportacion, previewImportacion } from "./combustible-importaciones";

export async function importarCombustibleHttp(req: Request, slug: string, confirmar: boolean) {
  const g = await requireTenantFlotaCombustible(slug, "conciliar");
  if (g.error) return g.error;
  try {
    const form = await req.formData(), file = form.get("file"), proveedorId = Number(form.get("proveedorId"));
    if (!Number.isSafeInteger(proveedorId) || proveedorId <= 0 || !(file instanceof File)) throw new ErrorDominioFormulario("Proveedor y archivo son obligatorios.");
    validarArchivoImportacion(file);
    const buffer = Buffer.from(await file.arrayBuffer());
    const actor = { id: g.session.id, username: g.session.username };
    const resultado = confirmar
      ? await confirmarImportacion(g.empresa.id, proveedorId, actor, buffer, file, String(form.get("token") ?? ""))
      : await previewImportacion(g.empresa.id, proveedorId, actor, buffer);
    return NextResponse.json(resultado, { status: confirmar ? 201 : 200, headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    if (e instanceof ErrorDominioFormulario || e instanceof UploadValidationError || e instanceof ErrorArchivoProveedor) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("[combustible-importacion]", e);
    return NextResponse.json({ error: "No se pudo procesar la importación." }, { status: 500 });
  }
}
