import { extname } from "path";
import { NextResponse } from "next/server";
import { requireTenantMultas } from "@/lib/tenant";
import { obtenerMulta } from "@/lib/multas/backend";
import { errorMultas } from "@/lib/multas/http";
import { idSchema } from "@/lib/multas/reglas";
import {
  listarDocumentosMulta,
  registrarDocumentoMulta,
  TIPOS_DOCUMENTO_MULTA,
  type TipoDocumentoMulta,
} from "@/lib/multas/documentos";
import { borrarUpload, guardarUpload } from "@/lib/uploads";

type Ctx = { params: Promise<{ slug: string; id: string }> };

// Whitelist LOCAL de Multas — más angosta que EXT_PERMITIDAS de
// src/lib/uploads.ts (que incluye webp/bmp para otros módulos que sí
// los necesitan). No se toca la constante global; esta validación es
// adicional y específica del expediente de Multas.
const EXT_PERMITIDAS_MULTAS = new Set([".jpg", ".jpeg", ".png", ".pdf"]);

/**
 * MULTAS-5 (secciones 6-8) — documentos del expediente: foto/escaneo de
 * la boleta (MULTA), comprobante de pago (COMPROBANTE_PAGO), factura
 * (FACTURA) u OTRO. Reutiliza ops_multa_documentos (MULTAS-2) y
 * guardarUpload() (mismo patrón que RRHH/Flota) — no crea un motor de
 * almacenamiento propio.
 */
export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { slug, id } = await ctx.params;
    const guard = await requireTenantMultas(slug, "ver");
    if (guard.error) return guard.error;
    const multaId = idSchema.parse(id);
    await obtenerMulta(guard.empresa.id, multaId); // valida tenant/existencia (404 si no aplica)
    const documentos = await listarDocumentosMulta(guard.empresa.id, multaId);
    return NextResponse.json({ documentos }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorMultas(error); }
}

export async function POST(req: Request, ctx: Ctx) {
  try {
    const { slug, id } = await ctx.params;
    const guard = await requireTenantMultas(slug, "editar");
    if (guard.error) return guard.error;
    const multaId = idSchema.parse(id);
    await obtenerMulta(guard.empresa.id, multaId);

    const form = await req.formData();
    const file = form.get("file") as File | null;
    const tipoRaw = String(form.get("tipo") ?? "OTRO");
    if (!file || typeof file.arrayBuffer !== "function") {
      return NextResponse.json({ error: "Archivo requerido." }, { status: 400 });
    }
    const tipo = (TIPOS_DOCUMENTO_MULTA as readonly string[]).includes(tipoRaw)
      ? (tipoRaw as TipoDocumentoMulta)
      : "OTRO";
    if (!EXT_PERMITIDAS_MULTAS.has(extname(file.name || "").toLowerCase())) {
      return NextResponse.json({ error: "Formato no permitido. Usa JPG, PNG o PDF." }, { status: 400 });
    }

    // Si registrarDocumentoMulta() falla después de que el archivo ya se
    // escribió en disco, el archivo NO debe quedar huérfano — se borra
    // con borrarUpload() (ya existente) y se relanza el error tal cual.
    // Nunca se borra si el INSERT sí tuvo éxito.
    let saved: Awaited<ReturnType<typeof guardarUpload>> | undefined;
    try {
      saved = await guardarUpload(guard.empresa.id, "multas", `multa${multaId}`, file);
      const docId = await registrarDocumentoMulta({
        empresaId: guard.empresa.id,
        multaId,
        tipoDocumento: tipo,
        rutaRelativa: saved.relative,
        nombreOriginal: saved.original,
        mimeType: file.type || "application/octet-stream",
        tamano: saved.size,
        subidoPorUsuarioId: guard.session.id,
      });
      return NextResponse.json({ mensaje: "Documento subido.", id: docId }, { status: 201 });
    } catch (error) {
      if (saved?.relative) borrarUpload(saved.relative);
      throw error;
    }
  } catch (error) { return errorMultas(error); }
}
