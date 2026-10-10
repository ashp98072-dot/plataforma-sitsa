import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantFacturacion } from "@/lib/tenant";
import { actualizarFacturaBorrador, obtenerFactura } from "@/lib/facturacion/facturas";
import { fact4CamposSchema, resolverEntradaFact4 } from "@/lib/facturacion/entrada-fact4";

type Ctx = { params: Promise<{ slug: string; id: string }> };

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
const lineaSchema = z.object({
  planId: z.number().int().positive(),
  montoAsignado: z.number().nonnegative().optional(),
  // Tratamiento de IVA de ESTA línea (true = ya incluido en la tarifa, false = se agrega). Explícito y por línea: una misma
  // factura puede mezclar ambos. Sin valor por defecto en el servidor.
  precioIncluyeIva: z.boolean(),
});
const editarSchema = z.object({
  clienteId: z.number().int().positive(),
  planes: z.array(lineaSchema).min(1),
  numeroFactura: z.string().trim().max(60).optional().nullable(),
  fechaEmision: z.string().regex(FECHA_RE).optional().nullable(),
  observaciones: z.string().trim().max(2000).optional().nullable(),
  ...fact4CamposSchema,
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

  // Reenviar la retención que el borrador ya tiene congelada no exige el permiso de cambio (lo exige cambiarla).
  let retencionVigente: number | null = null;
  if (d.retencionIvaPct != null) {
    const actual = await obtenerFactura(guard.empresa.id, facturaId);
    retencionVigente = actual?.contabilidad.retencionIva.aplicadaPct ?? null;
  }
  const fact4 = await resolverEntradaFact4({
    slug,
    empresaId: guard.empresa.id,
    clienteId: d.clienteId,
    entrada: d,
    retencionVigente,
  });
  if (!fact4.ok) return NextResponse.json({ error: fact4.error }, { status: fact4.status });

  const resultado = await actualizarFacturaBorrador(
    { empresaId: guard.empresa.id, usuarioId: guard.session.id, usuario: guard.session.username },
    facturaId,
    {
      clienteId: d.clienteId,
      planes: d.planes,
      numeroFactura: d.numeroFactura ?? null,
      fechaEmision: d.fechaEmision ?? null,
      observaciones: d.observaciones ?? null,
      ...fact4.datos,
    },
  );
  if (!resultado.ok) {
    return NextResponse.json({ error: resultado.error }, { status: resultado.status });
  }
  return NextResponse.json({ id: resultado.facturaId, mensaje: "Borrador actualizado." });
}
