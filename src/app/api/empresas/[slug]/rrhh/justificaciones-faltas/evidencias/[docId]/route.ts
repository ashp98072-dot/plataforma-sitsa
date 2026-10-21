import { createReadStream, existsSync, statSync } from "fs";
import { NextResponse } from "next/server";
import { Readable } from "stream";
import { requireTenantRrhh } from "@/lib/tenant";
import { absPathFromRelative, contentTypeFor } from "@/lib/uploads";
import { eliminarDocumentoPorTipo, obtenerDocumentoConPrefijo } from "@/lib/rrhh/documentos-por-tipo";

type Ctx = { params: Promise<{ slug: string; docId: string }> };

const PREFIJO = "Justificación de falta ";

/** Descarga privada de la evidencia: sesión + empresa + permiso de lectura de Reportes; solo documentos de este flujo. */
export async function GET(_req: Request, ctx: Ctx) {
  const { slug, docId } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "reportes", "ver");
  if (guard.error) return guard.error;
  const id = Number(docId);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  const doc = await obtenerDocumentoConPrefijo(guard.empresa.id, id, PREFIJO);
  if (!doc) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  const abs = absPathFromRelative(doc.rutaArchivo);
  if (!existsSync(abs)) return NextResponse.json({ error: "Archivo no encontrado en disco." }, { status: 404 });
  const stat = statSync(abs);
  return new NextResponse(Readable.toWeb(createReadStream(abs)) as unknown as BodyInit, {
    headers: {
      "Content-Type": contentTypeFor(doc.rutaArchivo),
      "Content-Length": String(stat.size),
      "Content-Disposition": `inline; filename="${encodeURIComponent(doc.nombreOriginal || "evidencia")}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/** Elimina la evidencia (permiso `incidencias:editar`); queda registrada en la bitácora con el actor. */
export async function DELETE(_req: Request, ctx: Ctx) {
  const { slug, docId } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "incidencias", "editar");
  if (guard.error) return guard.error;
  const id = Number(docId);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  const ok = await eliminarDocumentoPorTipo({
    empresaId: guard.empresa.id,
    docId: id,
    tipoDocumento: PREFIJO,
    usuario: guard.session.username,
    accionAuditoria: "justificacion_falta_evidencia_eliminada",
    detalleAuditoria: "Justificación de falta",
  });
  if (!ok) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  return NextResponse.json({ mensaje: "Evidencia eliminada." });
}
