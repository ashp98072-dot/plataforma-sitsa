import { createReadStream, existsSync, statSync } from "fs";
import { NextResponse } from "next/server";
import { Readable } from "stream";
import { requireTenantMultas } from "@/lib/tenant";
import { eliminarDocumentoMulta, obtenerDocumentoMulta } from "@/lib/multas/documentos";
import { absPathFromRelative, contentTypeFor } from "@/lib/uploads";
import { idSchema } from "@/lib/multas/reglas";

type Ctx = { params: Promise<{ slug: string; docId: string }> };

/**
 * MULTAS-5 (sección 9) — servir el archivo SOLO si la sesión pertenece a
 * esta empresa y tiene multas:ver, y el documento (obtenerDocumentoMulta)
 * pertenece a esa misma empresa — nunca una ruta pública directa. Mismo
 * patrón que empleados/documentos/[docId]/route.ts.
 */
export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { slug, docId } = await ctx.params;
    const guard = await requireTenantMultas(slug, "ver");
    if (guard.error) return guard.error;
    const doc = await obtenerDocumentoMulta(guard.empresa.id, idSchema.parse(docId));
    if (!doc) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
    const abs = absPathFromRelative(doc.rutaRelativa);
    if (!existsSync(abs)) {
      return NextResponse.json({ error: "Archivo no encontrado en disco." }, { status: 404 });
    }
    const stat = statSync(abs);
    const stream = createReadStream(abs);
    const webStream = Readable.toWeb(stream) as unknown as BodyInit;
    return new NextResponse(webStream, {
      headers: {
        "Content-Type": contentTypeFor(doc.rutaRelativa),
        "Content-Length": String(stat.size),
        "Content-Disposition": `inline; filename="${encodeURIComponent(doc.nombreOriginal || "documento")}"`,
      },
    });
  } catch (error) {
    console.error("GET documento multa (archivo)", error);
    return NextResponse.json({ error: "No se pudo leer el archivo." }, { status: 500 });
  }
}

/** Baja lógica (sección 9) — nunca DELETE físico ni del registro ni del archivo. */
export async function DELETE(req: Request, ctx: Ctx) {
  try {
    const { slug, docId } = await ctx.params;
    const guard = await requireTenantMultas(slug, "editar");
    if (guard.error) return guard.error;
    const body = await req.json().catch(() => ({}));
    const motivo = String((body as { motivo?: unknown }).motivo ?? "").trim() || "Sin motivo indicado.";
    const r = await eliminarDocumentoMulta(guard.empresa.id, idSchema.parse(docId), guard.session.id, motivo);
    if (!r.ok) return NextResponse.json({ error: r.mensaje }, { status: 404 });
    return NextResponse.json({ mensaje: r.mensaje });
  } catch (error) {
    console.error("DELETE documento multa", error);
    return NextResponse.json({ error: "No se pudo eliminar." }, { status: 500 });
  }
}
