import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantCotizaciones, requireTenantCotizacionesCosteo } from "@/lib/tenant";
import { ESTADOS_COTIZACION, crearCotizacion, listarCotizaciones } from "@/lib/tms/cotizaciones";
import { DOCUMENTOS_EMISOR, DOCUMENTO_EMISOR_DEFAULT } from "@/lib/tms/cotizacion-documento";
import { obtenerPresentacionComercial } from "@/lib/tms/cotizacion-presentacion";
import { ErrorCosteoYaRegistrado } from "@/lib/tms/cotizacion-costeo-db";
import { costeoPayloadSchema, mensajeErrorCosteo, prepararCosteo } from "@/lib/tms/cotizacion-costeo-servicio";

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
  servicioRefrigerado: z.boolean().optional(),
  kmIncluidos: z.number().nonnegative().nullable().optional(),
  tarifaKmAdicional: z.number().nonnegative().nullable().optional(),
  condicionesAdicionales: z.string().max(2000).nullable().optional(),
  observaciones: z.string().max(2000).nullable().optional(),
  // FASE 6 — documento comercial. La marca es un catálogo cerrado; atención/cargo/unidad son opcionales.
  documentoEmisor: z.enum(DOCUMENTOS_EMISOR).optional(),
  atencionNombre: z.string().max(160).nullable().optional(),
  atencionCargo: z.string().max(160).nullable().optional(),
  unidadDescripcion: z.string().max(160).nullable().optional(),
  // PRESENTACIÓN COMERCIAL — snapshot editable del texto del PDF. Si se omite/vacío al crear,
  // el POST lo resuelve desde el default de Ajustes de esta marca (ver más abajo); nunca se
  // recalcula al leer o exportar más tarde — eso lo lee directamente el PDF del snapshot guardado.
  mensajeComercial: z.string().max(2000).nullable().optional(),
  cierreComercial: z.string().max(2000).nullable().optional(),
  // COTIZACIONES-COSTEO: opcional. El costeo se RECALCULA en servidor (el cliente no manda resultados ni parámetros).
  costeo: costeoPayloadSchema.optional(),
});

export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantCotizaciones(slug, "crear");
  if (guard.error) return guard.error;

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }
  const { costeo, ...datos } = parsed.data;
  try {
    // Snapshot desde el primer momento: si el usuario dejó "Mensaje para el
    // cliente" vacío, se resuelve AHORA el default configurado en Ajustes
    // (o el fallback fijo de la marca) y se guarda ese texto — nunca queda
    // NULL para una cotización nueva, así el PDF de esta cotización nunca
    // cambia aunque mañana se edite el default en Ajustes.
    if (!datos.mensajeComercial?.trim() || !datos.cierreComercial?.trim()) {
      const marca = datos.documentoEmisor ?? DOCUMENTO_EMISOR_DEFAULT;
      const defaults = (await obtenerPresentacionComercial(guard.empresa.id))[marca];
      if (!datos.mensajeComercial?.trim()) datos.mensajeComercial = defaults.mensaje;
      if (!datos.cierreComercial?.trim()) datos.cierreComercial = defaults.cierre;
    }
    let preparado = null;
    if (costeo) {
      // Guardar costeo exige su propio permiso: sin él se rechaza TODO el alta (no se ignora en silencio).
      const guardCosteo = await requireTenantCotizacionesCosteo(slug, "crear");
      if (guardCosteo.error) return guardCosteo.error;
      preparado = await prepararCosteo(guard.empresa.id, costeo, { fechaEmision: datos.fechaEmision, tarifaCotizada: datos.tarifaCotizada, incluyeIva: datos.incluyeIva });
    }
    const cotizacion = await crearCotizacion(guard.empresa.id, datos, guard.session.username, preparado);
    return NextResponse.json({ mensaje: preparado ? "Cotización y costeo creados." : "Cotización creada.", cotizacion });
  } catch (error) {
    if (error instanceof ErrorCosteoYaRegistrado) return NextResponse.json({ error: error.message }, { status: 409 });
    const mensajeCosteo = mensajeErrorCosteo(error);
    if (mensajeCosteo) return NextResponse.json({ error: mensajeCosteo }, { status: 400 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo crear la cotización." }, { status: 400 });
  }
}
