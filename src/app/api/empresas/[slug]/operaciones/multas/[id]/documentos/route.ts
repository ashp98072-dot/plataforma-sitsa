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
import { guardarUpload } from "@/lib/uploads";

type Ctx = { params: Promise<{ slug: string; id: string }> };

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

    const saved = await guardarUpload(guard.empresa.id, "multas", `multa${multaId}`, file);
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
  } catch (error) { return errorMultas(error); }
}
