import { createReadStream, existsSync, statSync } from "fs";
import { NextResponse } from "next/server";
import { Readable } from "stream";
import { requireTenant } from "@/lib/tenant";
import { obtenerFirmaUsuario } from "@/lib/firmas/usuario-firmas";
import { absPathFromRelative, contentTypeFor } from "@/lib/uploads";

type Ctx = { params: Promise<{ slug: string }> };

/**
 * MI-FIRMA-1 — sirve el PNG de la firma personal del usuario AUTENTICADO
 * actual — nunca acepta una ruta ni un usuario_id del cliente, nunca una
 * ruta pública directa a /uploads. Mismo patrón que
 * .../tms/viaticos/firmas/[firmaId]/imagen/route.ts.
 */
export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { slug } = await ctx.params;
    const guard = await requireTenant(slug);
    if (guard.error) return guard.error;

    const firma = await obtenerFirmaUsuario(guard.session.id);
    if (!firma) {
      return NextResponse.json({ error: "Sin firma guardada." }, { status: 404 });
    }

    const abs = absPathFromRelative(firma.imagenRuta);
    if (!existsSync(abs)) {
      return NextResponse.json({ error: "Archivo no encontrado en disco." }, { status: 404 });
    }
    const stat = statSync(abs);
    const stream = createReadStream(abs);
    const webStream = Readable.toWeb(stream) as unknown as BodyInit;
    return new NextResponse(webStream, {
      headers: {
        "Content-Type": firma.imagenMime || contentTypeFor(firma.imagenRuta),
        "Content-Length": String(stat.size),
        "Cache-Control": "private, no-store",
        "Content-Disposition": "inline",
      },
    });
  } catch (error) {
    console.error("GET mi-firma imagen", error);
    return NextResponse.json({ error: "No se pudo leer la imagen." }, { status: 500 });
  }
}
