import { createReadStream, existsSync, statSync } from "fs";
import { Readable } from "stream";
import { NextResponse } from "next/server";
import { requireTenantEntregas } from "@/lib/tenant";
import { EXTENSION_DE_MIME, leerEvidenciaEntrega } from "@/lib/entregas/evidencia";
import { cargarEntregaDeModulo, idDeRuta, respuestaFalloOperacion, respuestaNoEncontrada } from "@/lib/entregas/http";
import { validarRutaArchivoEmpresa } from "@/lib/uploads";

type Ctx = { params: Promise<{ slug: string; entregaId: string }> };

/**
 * Evidencia escaneada (constancia firmada) de una recepción presencial. Nunca una ruta pública a /uploads: siempre por este
 * endpoint autenticado, que valida sesión + empresa + que la entrega sea de Fondos, y que la ruta guardada pertenezca a la
 * carpeta de ESA empresa (`validarRutaArchivoEmpresa`). Sin evidencia (histórico, firma dibujada, pendiente) => 404.
 */
export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { slug, entregaId: idRuta } = await ctx.params;
    const guard = await requireTenantEntregas(slug, { aceptaGastosVer: true });
    if (guard.error) return guard.error;
    const entregaId = idDeRuta(idRuta);
    if (!entregaId || !(await cargarEntregaDeModulo(guard.empresa.id, entregaId, "FONDOS"))) return respuestaNoEncontrada();

    const evidencia = await leerEvidenciaEntrega(guard.empresa.id, entregaId);
    if (!evidencia) return NextResponse.json({ error: "Sin evidencia adjunta." }, { status: 404 });

    const abs = validarRutaArchivoEmpresa(guard.empresa.id, evidencia.ruta);
    if (!abs || !existsSync(abs)) return NextResponse.json({ error: "Archivo no encontrado." }, { status: 404 });
    // Solo se sirve un tipo de la lista blanca; cualquier otra cosa guardada se trata como binario descargable.
    const permitido = Object.prototype.hasOwnProperty.call(EXTENSION_DE_MIME, evidencia.mime);
    const stat = statSync(abs);
    const nombre = evidencia.nombre.replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 120) || "constancia-firmada";
    return new NextResponse(Readable.toWeb(createReadStream(abs)) as unknown as BodyInit, {
      headers: {
        "Content-Type": permitido ? evidencia.mime : "application/octet-stream",
        "Content-Length": String(stat.size),
        "Content-Disposition": `${permitido ? "inline" : "attachment"}; filename="${nombre}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch (error) {
    return respuestaFalloOperacion(error, "GET tms/fondos/entregas/[entregaId]/evidencia");
  }
}
