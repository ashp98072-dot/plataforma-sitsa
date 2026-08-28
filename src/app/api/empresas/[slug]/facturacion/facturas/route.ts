import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantFacturacion } from "@/lib/tenant";
import { crearFactura, listarFacturas, type EstadoAdminFactura } from "@/lib/facturacion/facturas";

type Ctx = { params: Promise<{ slug: string }> };

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
const ESTADOS: EstadoAdminFactura[] = ["Borrador", "Emitida", "Anulada"];

const lineaSchema = z.object({
  planId: z.number().int().positive(),
  montoAsignado: z.number().nonnegative().optional(),
});
const crearSchema = z.object({
  clienteId: z.number().int().positive(),
  planes: z.array(lineaSchema).min(1),
  numeroFactura: z.string().trim().max(60).optional().nullable(),
  fechaEmision: z.string().regex(FECHA_RE).optional().nullable(),
  observaciones: z.string().trim().max(2000).optional().nullable(),
});

/** FACT-1 — lectura: facturacion:ver. Nunca requiere tms:ver. */
export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantFacturacion(slug, "ver");
  if (guard.error) return guard.error;

  const p = new URL(req.url).searchParams;
  const clienteId = Number(p.get("clienteId"));
  const estadoAdmin = p.get("estadoAdmin");
  const facturas = await listarFacturas(guard.empresa.id, {
    clienteId: Number.isInteger(clienteId) && clienteId > 0 ? clienteId : undefined,
    estadoAdmin: estadoAdmin && (ESTADOS as string[]).includes(estadoAdmin) ? (estadoAdmin as EstadoAdminFactura) : undefined,
    fechaDesde: p.get("fechaDesde") && FECHA_RE.test(p.get("fechaDesde")!) ? p.get("fechaDesde")! : undefined,
    fechaHasta: p.get("fechaHasta") && FECHA_RE.test(p.get("fechaHasta")!) ? p.get("fechaHasta")! : undefined,
  });
  return NextResponse.json({ facturas }, { headers: { "Cache-Control": "private, no-store" } });
}

/** Crea SIEMPRE como Borrador. facturacion:crear. */
export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantFacturacion(slug, "crear");
  if (guard.error) return guard.error;

  const parsed = crearSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }
  const d = parsed.data;

  const resultado = await crearFactura(
    { empresaId: guard.empresa.id, usuarioId: guard.session.id, usuario: guard.session.username },
    {
      clienteId: d.clienteId,
      planes: d.planes,
      numeroFactura: d.numeroFactura ?? null,
      fechaEmision: d.fechaEmision ?? null,
      observaciones: d.observaciones ?? null,
    },
  );
  if (!resultado.ok) {
    return NextResponse.json({ error: resultado.error }, { status: resultado.status });
  }
  return NextResponse.json({ id: resultado.facturaId, mensaje: "Factura creada como Borrador." }, { status: 201 });
}
