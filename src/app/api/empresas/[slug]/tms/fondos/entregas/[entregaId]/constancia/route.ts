import { NextResponse } from "next/server";
import { requireTenantEntregas } from "@/lib/tenant";
import { cargarEntregaDeModulo, idDeRuta, respuestaFalloOperacion, respuestaNoEncontrada } from "@/lib/entregas/http";
import { generarPdfConstanciaEntrega } from "@/lib/tms/fondos-constancia-entrega-pdf";

type Ctx = { params: Promise<{ slug: string; entregaId: string }> };

/**
 * Constancia PDF de una entrega de Solicitud de fondo (solo lectura):
 *   PRESENCIAL pendiente → constancia PREVIA para imprimir y firmar (sin datos del receptor);
 *   RECIBIDA             → constancia FINAL;
 *   SISTEMA pendiente, RECHAZADA o ANULADA → 409 (no hay constancia).
 * Empresa y usuario salen de la sesión; una entrega ajena, inexistente o de otro módulo responde el mismo 404. Mismo nivel de
 * lectura que el historial (permisos de entrega o «ver Solicitudes de fondo»).
 */
export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { slug, entregaId: idRuta } = await ctx.params;
    const guard = await requireTenantEntregas(slug, { aceptaGastosVer: true });
    if (guard.error) return guard.error;
    const entregaId = idDeRuta(idRuta);
    if (!entregaId || !(await cargarEntregaDeModulo(guard.empresa.id, entregaId, "FONDOS"))) return respuestaNoEncontrada();

    const r = await generarPdfConstanciaEntrega(guard.empresa.id, entregaId, guard.empresa.nombre);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    return new NextResponse(new Uint8Array(r.buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${r.nombreArchivo}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return respuestaFalloOperacion(error, "GET tms/fondos/entregas/[entregaId]/constancia");
  }
}
