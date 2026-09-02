import { readFileSync } from "fs";
import { NextResponse } from "next/server";
import { requireClienteSession } from "@/lib/tms/cliente-portal-guard";
import { obtenerEvidenciaClienteParaArchivo } from "@/lib/tms/cliente-portal-seguimiento";
import { absPathFromRelative, contentTypeFor } from "@/lib/uploads";

type Ctx = { params: Promise<{ id: string; paradaId: string; evidenciaId: string }> };

/**
 * CLIENTE-PORTAL-4 (sección 9) — sirve el archivo de UNA evidencia,
 * revalidando la cadena completa cliente->solicitud->plan->parada->
 * evidencia en cada petición (nunca "GET evidencia por id" sin
 * ownership, ni siquiera con el paradaId/solicitudId correctos de otra
 * combinación). Mismo mecanismo YA existente que usa el portal del
 * piloto (GET /api/portal/viajes/[id]/evidencias?adjuntoId=):
 * readFileSync(absPathFromRelative(...)) — la ruta real del disco
 * NUNCA se expone en ningún JSON, solo se resuelve server-side a partir
 * de un id de evidencia ya autorizado.
 */
export async function GET(_req: Request, ctx: Ctx) {
  const guard = await requireClienteSession();
  if (guard.error) return guard.error;
  const { session } = guard;

  const { id, paradaId, evidenciaId } = await ctx.params;
  const solicitudId = Number(id);
  const paradaIdNum = Number(paradaId);
  const evidenciaIdNum = Number(evidenciaId);
  if (
    !Number.isFinite(solicitudId) ||
    !Number.isFinite(paradaIdNum) ||
    !Number.isFinite(evidenciaIdNum)
  ) {
    return NextResponse.json({ error: "Evidencia no encontrada." }, { status: 404 });
  }

  const evidencia = await obtenerEvidenciaClienteParaArchivo(
    session.empresaId,
    session.clienteId,
    solicitudId,
    paradaIdNum,
    evidenciaIdNum,
  );
  if (!evidencia) {
    return NextResponse.json({ error: "Evidencia no encontrada." }, { status: 404 });
  }

  try {
    const nombre = evidencia.nombreOriginal;
    return new NextResponse(readFileSync(absPathFromRelative(evidencia.rutaRelativa)), {
      headers: {
        "Content-Type": evidencia.mime || contentTypeFor(nombre),
        "Content-Disposition": `inline; filename="${nombre.replace(/"/g, "")}"`,
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch {
    return NextResponse.json({ error: "Archivo no encontrado." }, { status: 404 });
  }
}
