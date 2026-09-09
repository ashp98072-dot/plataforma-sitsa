import { NextResponse } from "next/server";
import { requireTenantGastos } from "@/lib/tenant";
import { generarPdfSolicitudFondoAutorizada } from "@/lib/tms/fondos-solicitud-pdf";

type Ctx = { params: Promise<{ slug: string; id: string }> };

/**
 * SOLICITUD-FONDOS-PDF-AUTORIZADO-1 — PDF formal (encabezado, tabla de
 * detalle, total, firmas y notas) de UNA solicitud de fondo. Solo
 * disponible Autorizada/Liquidada (ver generarPdfSolicitudFondoAutorizada,
 * §6 del ticket) — Pendiente/Rechazada devuelven 400 con un mensaje
 * claro, nunca un PDF "autorizado" a medias.
 */
export async function GET(_req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireTenantGastos(slug, "ver");
  if (guard.error) return guard.error;

  const resultado = await generarPdfSolicitudFondoAutorizada(guard.empresa.id, Number(id), guard.empresa.nombre);
  if (!resultado.ok) {
    return NextResponse.json({ error: resultado.error }, { status: resultado.status });
  }
  return new NextResponse(new Uint8Array(resultado.buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${resultado.nombreArchivo}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
