import { NextResponse } from "next/server";
import { requireTenantCotizaciones } from "@/lib/tenant";
import { obtenerCotizacion } from "@/lib/tms/cotizaciones";
import { cotizacionPdf } from "@/lib/tms/cotizacion-pdf";
import { nombreArchivoCotizacionPdf } from "@/lib/tms/cotizacion-documento";

type Ctx = { params: Promise<{ slug: string; id: string }> };

/**
 * `?modo=ver` → `inline` (el navegador lo muestra; la UI lo abre en otra pestaña). Cualquier otro valor o sin
 * parámetro → `attachment` (descarga), comportamiento anterior. Mismo permiso, empresa y contenido en ambos modos.
 */
export async function GET(req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireTenantCotizaciones(slug, "ver");
  if (guard.error) return guard.error;
  const cotizacion = await obtenerCotizacion(guard.empresa.id, Number(id));
  if (!cotizacion) return NextResponse.json({ error: "Cotización no encontrada." }, { status: 404 });
  const buffer = await cotizacionPdf(cotizacion);
  const disposicion = new URL(req.url).searchParams.get("modo") === "ver" ? "inline" : "attachment";
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${disposicion}; filename="${nombreArchivoCotizacionPdf(cotizacion.codigo, cotizacion.documentoEmisor)}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
