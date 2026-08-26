import { NextResponse } from "next/server";
import { requireTenantRrhh } from "@/lib/tenant";
import { obtenerEntrevista } from "@/lib/rrhh/entrevistas";
import { listarDocumentosEntrevista, registrarDocumentoEntrevista, TIPOS_DOCUMENTO_CANDIDATO } from "@/lib/rrhh/entrevista-documentos";
import { guardarUpload } from "@/lib/uploads";

type Ctx = { params: Promise<{ slug: string; id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { slug, id: raw } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "entrevistas", "ver");
  if (guard.error) return guard.error;
  const id = Number(raw);
  if (!id || !(await obtenerEntrevista(guard.empresa.id, id)))
    return NextResponse.json({ error: "Entrevista no encontrada." }, { status: 404 });
  return NextResponse.json({ documentos: await listarDocumentosEntrevista(guard.empresa.id, id) });
}

export async function POST(req: Request, ctx: Ctx) {
  const { slug, id: raw } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "entrevistas", "editar");
  if (guard.error) return guard.error;
  const id = Number(raw);
  if (!id || !(await obtenerEntrevista(guard.empresa.id, id)))
    return NextResponse.json({ error: "Entrevista no encontrada." }, { status: 404 });
  try {
    const form = await req.formData();
    const file = form.get("file") as File | null;
    if (!file || typeof file.arrayBuffer !== "function")
      return NextResponse.json({ error: "Archivo requerido." }, { status: 400 });
    const rawTipo = String(form.get("tipo") ?? "Otro");
    const tipo = (TIPOS_DOCUMENTO_CANDIDATO as readonly string[]).includes(rawTipo) ? rawTipo : "Otro";
    const saved = await guardarUpload(guard.empresa.id, "documentos", `candidato${id}`, file);
    const docId = await registrarDocumentoEntrevista({
      empresaId: guard.empresa.id, entrevistaId: id, tipoDocumento: tipo,
      rutaArchivo: saved.relative, nombreOriginal: saved.original, subidoPor: guard.session.username,
    });
    return NextResponse.json({ id: docId, mensaje: "Documento agregado al expediente del candidato." });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo subir." }, { status: 500 });
  }
}
