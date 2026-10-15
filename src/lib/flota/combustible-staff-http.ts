import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { ErrorDominioFormulario } from "@/lib/validacion-formulario";
import { UploadValidationError } from "@/lib/uploads";
import { requireTenantFlotaCombustible } from "@/lib/tenant";
import { combustibleStaffSchema } from "./combustible-staff-schema";
import { guardarCombustibleStaff } from "./combustible-staff";

export async function guardarCombustibleHttp(req: Request, slug: string, id?: number) {
  const guard = await requireTenantFlotaCombustible(slug, id == null ? "registrar" : "editar_pendientes");
  if (guard.error) return guard.error;
  if (id !== undefined && (!Number.isSafeInteger(id) || id <= 0)) return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  try {
    const form = await req.formData();
    const input = combustibleStaffSchema.parse(Object.fromEntries(form.entries()));
    const archivo = form.get("file");
    const file = archivo instanceof File && archivo.size > 0 ? archivo : null;
    const cargaId = await guardarCombustibleStaff(guard.empresa.id, { usuarioId: guard.session.id, username: guard.session.username }, input, file, id);
    return NextResponse.json({ id: cargaId }, { status: id == null ? 201 : 200 });
  } catch (error) {
    if (error instanceof ZodError) return NextResponse.json({ error: error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join(" ") }, { status: 400 });
    if (error instanceof ErrorDominioFormulario || error instanceof UploadValidationError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof TypeError) return NextResponse.json({ error: "Formulario inválido." }, { status: 400 });
    console.error("[combustible-staff] guardar", error);
    return NextResponse.json({ error: "No se pudo guardar el vale." }, { status: 500 });
  }
}
