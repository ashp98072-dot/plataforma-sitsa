import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantFacturacion } from "@/lib/tenant";
import { actualizarFacturaBorrador, obtenerFactura } from "@/lib/facturacion/facturas";

type Ctx = { params: Promise<{ slug: string; id: string }> };

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
const lineaSchema = z.object({
  planId: z.number().int().positive(),
  montoAsignado: z.number().nonnegative().optional(),
});
const editarSchema = z.object({
  clienteId: z.number().int().positive(),
  planes: z.array(lineaSchema).min(1),
  numeroFactura: z.string().trim().max(60).optional().nullable(),
  fechaEmision: z.string().regex(FECHA_RE).optional().nullable(),
  observaciones: z.string().trim().max(2000).optional().nullable(),
});

function idValido(id: string): number | null {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function GET(_req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireTenantFacturacion(slug, "ver");
  if (guard.error) return guard.error;

  const facturaId = idValido(id);
  if (!facturaId) return NextResponse.json({ error: "ID inválido." }, { status: 400 });

  const detalle = await obtenerFactura(guard.empresa.id, facturaId);
  if (!detalle) return NextResponse.json({ error: "Factura no encontrada." }, { status: 404 });
  return NextResponse.json(detalle, { headers: { "Cache-Control": "private, no-store" } });
}

/** Solo estado_admin='Borrador' — reaplica TODAS las validaciones (ver src/lib/facturacion/facturas.ts). */
export async function PATCH(req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireTenantFacturacion(slug, "editar");
  if (guard.error) return guard.error;

  const facturaId = idValido(id);
  if (!facturaId) return NextResponse.json({ error: "ID inválido." }, { status: 400 });

  const parsed = editarSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }
  const d = parsed.data;

  const resultado = await actualizarFacturaBorrador(
    { empresaId: guard.empresa.id, usuarioId: guard.session.id, usuario: guard.session.username },
    facturaId,
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
  return NextResponse.json({ id: resultado.facturaId, mensaje: "Borrador actualizado." });
}
