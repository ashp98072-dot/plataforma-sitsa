import { createReadStream, existsSync, statSync } from "fs";
import { Readable } from "stream";
import { NextResponse } from "next/server";
import { requireTenantRrhh } from "@/lib/tenant";
import { eliminarDocumentoEntrevista, obtenerDocumentoEntrevista } from "@/lib/rrhh/entrevista-documentos";
import { absPathFromRelative, contentTypeFor } from "@/lib/uploads";

type Ctx = { params: Promise<{ slug: string; docId: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { slug, docId: raw } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "entrevistas", "ver");
  if (guard.error) return guard.error;
  const doc = await obtenerDocumentoEntrevista(guard.empresa.id, Number(raw));
  if (!doc) return NextResponse.json({ error: "Documento no encontrado." }, { status: 404 });
  const abs = absPathFromRelative(doc.rutaArchivo);
  if (!existsSync(abs)) return NextResponse.json({ error: "Archivo no encontrado en disco." }, { status: 404 });
  const stream = Readable.toWeb(createReadStream(abs)) as unknown as BodyInit;
  return new NextResponse(stream, { headers: {
    "Content-Type": contentTypeFor(doc.rutaArchivo),
    "Content-Length": String(statSync(abs).size),
    "Content-Disposition": `inline; filename="${encodeURIComponent(doc.nombreOriginal || "documento")}"`,
  }});
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { slug, docId: raw } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "entrevistas", "editar");
  if (guard.error) return guard.error;
  const ok = await eliminarDocumentoEntrevista(guard.empresa.id, Number(raw));
  return ok ? NextResponse.json({ mensaje: "Documento eliminado." }) : NextResponse.json({ error: "Documento no encontrado." }, { status: 404 });
}
