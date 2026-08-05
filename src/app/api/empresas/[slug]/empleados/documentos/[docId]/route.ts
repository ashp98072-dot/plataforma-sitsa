import { createReadStream, existsSync, statSync } from "fs";
import { NextResponse } from "next/server";
import { Readable } from "stream";
import { requireTenantModulo } from "@/lib/tenant";
import { eliminarDocumento, obtenerDocumento } from "@/lib/rrhh/documentos";
import { absPathFromRelative, contentTypeFor } from "@/lib/uploads";

type Ctx = { params: Promise<{ slug: string; docId: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { slug, docId: raw } = await ctx.params;
  const guard = await requireTenantModulo(slug, "rrhh");
  if (guard.error) return guard.error;

  const docId = Number(raw);
  if (!docId) {
    return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  }

  try {
    const doc = await obtenerDocumento(guard.empresa.id, docId);
    if (!doc) {
      return NextResponse.json({ error: "No encontrado." }, { status: 404 });
    }
    const abs = absPathFromRelative(doc.rutaArchivo);
    if (!existsSync(abs)) {
      return NextResponse.json(
        { error: "Archivo no encontrado en disco." },
        { status: 404 },
      );
    }
    const stat = statSync(abs);
    const stream = createReadStream(abs);
    const webStream = Readable.toWeb(stream) as unknown as BodyInit;
    return new NextResponse(webStream, {
      headers: {
        "Content-Type": contentTypeFor(doc.rutaArchivo),
        "Content-Length": String(stat.size),
        "Content-Disposition": `inline; filename="${encodeURIComponent(doc.nombreOriginal || "documento")}"`,
      },
    });
  } catch (err) {
    console.error("GET documento file", err);
    return NextResponse.json({ error: "No se pudo leer el archivo." }, { status: 500 });
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { slug, docId: raw } = await ctx.params;
  const guard = await requireTenantModulo(slug, "rrhh", true);
  if (guard.error) return guard.error;

  const docId = Number(raw);
  if (!docId) {
    return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  }

  try {
    const result = await eliminarDocumento(guard.empresa.id, docId);
    if (!result.ok) {
      return NextResponse.json({ error: result.mensaje }, { status: 404 });
    }
    return NextResponse.json({ mensaje: result.mensaje });
  } catch (err) {
    console.error("DELETE documento", err);
    return NextResponse.json({ error: "No se pudo eliminar." }, { status: 500 });
  }
}
