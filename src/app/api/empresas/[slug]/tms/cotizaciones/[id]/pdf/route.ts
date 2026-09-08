import { NextResponse } from "next/server";
import { requireTenantCotizaciones } from "@/lib/tenant";
import { obtenerCotizacion } from "@/lib/tms/cotizaciones";
import { cotizacionPdf } from "@/lib/tms/cotizacion-pdf";

type Ctx = { params: Promise<{ slug: string; id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireTenantCotizaciones(slug, "ver");
  if (guard.error) return guard.error;
  const cotizacion = await obtenerCotizacion(guard.empresa.id, Number(id));
  if (!cotizacion) return NextResponse.json({ error: "Cotización no encontrada." }, { status: 404 });
  const buffer = await cotizacionPdf(guard.empresa.nombre, cotizacion);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${cotizacion.codigo}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
