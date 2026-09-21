import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantCotizaciones, requireTenantCotizacionesCosteo } from "@/lib/tenant";
import { actualizarCotizacion, obtenerCotizacion } from "@/lib/tms/cotizaciones";
import { ErrorCosteoYaRegistrado } from "@/lib/tms/cotizacion-costeo-db";
import { costeoPayloadSchema, mensajeErrorCosteo, prepararCosteo } from "@/lib/tms/cotizacion-costeo-servicio";

type Ctx = { params: Promise<{ slug: string; id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireTenantCotizaciones(slug, "ver");
  if (guard.error) return guard.error;
  const cotizacion = await obtenerCotizacion(guard.empresa.id, Number(id));
  if (!cotizacion) return NextResponse.json({ error: "Cotización no encontrada." }, { status: 404 });
  return NextResponse.json({ cotizacion });
}

const schema = z.object({
  clienteId: z.number().int().positive().optional(),
  rutaId: z.number().int().positive().nullable().optional(),
  origenTexto: z.string().max(300).nullable().optional(),
  destinoTexto: z.string().max(300).nullable().optional(),
  tarifaCotizada: z.number().positive().max(9999999999.99).optional(),
  incluyeIva: z.boolean().optional(),
  fechaEmision: z.string().min(1).optional(),
  fechaVencimiento: z.string().nullable().optional(),
  pilotoIncluido: z.boolean().optional(),
  gpsIncluido: z.boolean().optional(),
  seguroMercaderiaIncluido: z.boolean().optional(),
  seguroTercerosIncluido: z.boolean().optional(),
  servicioRefrigerado: z.boolean().optional(),
  kmIncluidos: z.number().nonnegative().nullable().optional(),
  tarifaKmAdicional: z.number().nonnegative().nullable().optional(),
  condicionesAdicionales: z.string().max(2000).nullable().optional(),
  observaciones: z.string().max(2000).nullable().optional(),
  // COTIZACIONES-COSTEO: registra el snapshot por primera vez; si ya existe, 409 (inmutable).
  costeo: costeoPayloadSchema.optional(),
});

/** Solo aplica mientras la cotización está en Borrador — ver actualizarCotizacion en cotizaciones.ts. */
export async function PATCH(req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireTenantCotizaciones(slug, "editar");
  if (guard.error) return guard.error;

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }
  const { costeo, ...cambios } = parsed.data;
  try {
    let preparado = null;
    if (costeo) {
      const guardCosteo = await requireTenantCotizacionesCosteo(slug, "editar");
      if (guardCosteo.error) return guardCosteo.error;
      // El contexto comercial (fecha/tarifa/IVA) es el de la cotización tal como quedará tras este PATCH.
      const actual = await obtenerCotizacion(guard.empresa.id, Number(id));
      if (!actual) return NextResponse.json({ error: "Cotización no encontrada." }, { status: 404 });
      preparado = await prepararCosteo(guard.empresa.id, costeo, {
        fechaEmision: cambios.fechaEmision ?? actual.fechaEmision,
        tarifaCotizada: cambios.tarifaCotizada ?? actual.tarifaCotizada,
        incluyeIva: cambios.incluyeIva ?? actual.incluyeIva,
      });
    }
    const cotizacion = await actualizarCotizacion(guard.empresa.id, Number(id), cambios, preparado, guard.session.username);
    if (!cotizacion) return NextResponse.json({ error: "Cotización no encontrada." }, { status: 404 });
    return NextResponse.json({ mensaje: "Cotización actualizada.", cotizacion });
  } catch (error) {
    if (error instanceof ErrorCosteoYaRegistrado) return NextResponse.json({ error: error.message }, { status: 409 });
    const mensajeCosteo = mensajeErrorCosteo(error);
    if (mensajeCosteo) return NextResponse.json({ error: mensajeCosteo }, { status: 400 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo actualizar la cotización." }, { status: 400 });
  }
}
