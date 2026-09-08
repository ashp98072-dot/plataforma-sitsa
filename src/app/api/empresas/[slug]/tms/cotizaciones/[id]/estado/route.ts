import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantCotizaciones } from "@/lib/tenant";
import { ESTADOS_COTIZACION, cambiarEstadoCotizacion } from "@/lib/tms/cotizaciones";

type Ctx = { params: Promise<{ slug: string; id: string }> };

const schema = z.object({ estado: z.enum(ESTADOS_COTIZACION) });

export async function PATCH(req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireTenantCotizaciones(slug, "editar");
  if (guard.error) return guard.error;

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }
  try {
    const cotizacion = await cambiarEstadoCotizacion(guard.empresa.id, Number(id), parsed.data.estado, guard.session.username);
    if (!cotizacion) return NextResponse.json({ error: "Cotización no encontrada." }, { status: 404 });
    return NextResponse.json({ mensaje: "Estado actualizado.", cotizacion });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo cambiar el estado." }, { status: 400 });
  }
}
