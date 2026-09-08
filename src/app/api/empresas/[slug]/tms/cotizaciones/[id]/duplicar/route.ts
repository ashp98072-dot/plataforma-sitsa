import { NextResponse } from "next/server";
import { requireTenantCotizaciones } from "@/lib/tenant";
import { duplicarCotizacion } from "@/lib/tms/cotizaciones";

type Ctx = { params: Promise<{ slug: string; id: string }> };

export async function POST(_req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireTenantCotizaciones(slug, "crear");
  if (guard.error) return guard.error;
  try {
    const cotizacion = await duplicarCotizacion(guard.empresa.id, Number(id), guard.session.username);
    if (!cotizacion) return NextResponse.json({ error: "Cotización original no encontrada." }, { status: 404 });
    return NextResponse.json({ mensaje: "Cotización duplicada como nuevo Borrador.", cotizacion });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo duplicar la cotización." }, { status: 400 });
  }
}
