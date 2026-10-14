import { createReadStream, existsSync, statSync } from "fs";
import { NextResponse } from "next/server";
import { Readable } from "stream";
import { requireTenantRrhh } from "@/lib/tenant";
import { absPathFromRelative, contentTypeFor } from "@/lib/uploads";
import { PREFIJO_COMPROBANTE_CUMPLEANIOS } from "@/lib/rrhh/cumpleanios-shared";
import { eliminarDocumentoPorTipo, obtenerDocumentoConPrefijo } from "@/lib/rrhh/documentos-por-tipo";

type Ctx = { params: Promise<{ slug: string; docId: string }> };

/**
 * Descarga privada del comprobante: sesión + empresa + permiso de lectura de Reportes de RRHH. Solo sirve documentos de este flujo
 * (tipo «Comprobante de cumpleaños AAAA»); nunca otro documento del expediente. Nunca se expone una URL pública del archivo.
 */
export async function GET(_req: Request, ctx: Ctx) {
  const { slug, docId } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "reportes", "ver");
  if (guard.error) return guard.error;
  const id = Number(docId);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  const doc = await obtenerDocumentoConPrefijo(guard.empresa.id, id, PREFIJO_COMPROBANTE_CUMPLEANIOS);
  if (!doc) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  const abs = absPathFromRelative(doc.rutaArchivo);
  if (!existsSync(abs)) return NextResponse.json({ error: "Archivo no encontrado en disco." }, { status: 404 });
  const stat = statSync(abs);
  return new NextResponse(Readable.toWeb(createReadStream(abs)) as unknown as BodyInit, {
    headers: {
      "Content-Type": contentTypeFor(doc.rutaArchivo),
      "Content-Length": String(stat.size),
      "Content-Disposition": `inline; filename="${encodeURIComponent(doc.nombreOriginal || "comprobante")}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/** Elimina el comprobante: mismo permiso que quitar documentos del expediente (`empleados:eliminar`); queda en la bitácora. */
export async function DELETE(_req: Request, ctx: Ctx) {
  const { slug, docId } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "empleados", "eliminar");
  if (guard.error) return guard.error;
  const id = Number(docId);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  const ok = await eliminarDocumentoPorTipo({
    empresaId: guard.empresa.id,
    docId: id,
    tipoDocumento: PREFIJO_COMPROBANTE_CUMPLEANIOS,
    usuario: guard.session.username,
    accionAuditoria: "comprobante_cumpleanios_eliminado",
    detalleAuditoria: "Comprobante de cumpleaños",
  });
  if (!ok) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  return NextResponse.json({ mensaje: "Comprobante eliminado." });
}
