import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantCotizaciones } from "@/lib/tenant";
import { ESTADOS_COTIZACION, crearCotizacion, listarCotizaciones } from "@/lib/tms/cotizaciones";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantCotizaciones(slug, "ver");
  if (guard.error) return guard.error;

  const p = new URL(req.url).searchParams;
  const clienteId = Number(p.get("clienteId"));
  const estado = p.get("estado");
  const cotizaciones = await listarCotizaciones(guard.empresa.id, {
    clienteId: Number.isInteger(clienteId) && clienteId > 0 ? clienteId : undefined,
    estado: estado && (ESTADOS_COTIZACION as readonly string[]).includes(estado) ? (estado as (typeof ESTADOS_COTIZACION)[number]) : undefined,
    fechaDesde: p.get("fechaDesde") || undefined,
    fechaHasta: p.get("fechaHasta") || undefined,
  });
  return NextResponse.json(
    { cotizaciones, estados: ESTADOS_COTIZACION },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

const schema = z.object({
  clienteId: z.number().int().positive(),
  rutaId: z.number().int().positive().nullable().optional(),
  origenTexto: z.string().max(300).nullable().optional(),
  destinoTexto: z.string().max(300).nullable().optional(),
  tarifaCotizada: z.number().positive().max(9999999999.99),
  incluyeIva: z.boolean().optional(),
  fechaEmision: z.string().min(1),
  fechaVencimiento: z.string().nullable().optional(),
  pilotoIncluido: z.boolean().optional(),
  gpsIncluido: z.boolean().optional(),
  seguroMercaderiaIncluido: z.boolean().optional(),
  seguroTercerosIncluido: z.boolean().optional(),
  kmIncluidos: z.number().nonnegative().nullable().optional(),
  tarifaKmAdicional: z.number().nonnegative().nullable().optional(),
  condicionesAdicionales: z.string().max(2000).nullable().optional(),
  observaciones: z.string().max(2000).nullable().optional(),
});

export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantCotizaciones(slug, "crear");
  if (guard.error) return guard.error;

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }
  try {
    const cotizacion = await crearCotizacion(guard.empresa.id, parsed.data, guard.session.username);
    return NextResponse.json({ mensaje: "Cotización creada.", cotizacion });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo crear la cotización." }, { status: 400 });
  }
}
