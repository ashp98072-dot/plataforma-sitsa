import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantFacturacion } from "@/lib/tenant";
import { emitirFactura } from "@/lib/facturacion/facturas";
import { respuestaErrorCredito } from '@/lib/facturacion/credito';

type Ctx = { params: Promise<{ slug: string; id: string }> };
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
const schema = z.strictObject({
  numeroFactura: z.string().trim().min(1).max(60).optional(),
  fechaEmision: z.string().regex(FECHA_RE).optional(),
  vencimientoToken: z.string().max(4000).optional(),
});

/** Borrador -> Emitida. Exige número + fecha (ya guardados o enviados aquí) + ≥1 viaje + viajes aún Cerrados. facturacion:editar. */
export async function POST(req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireTenantFacturacion(slug, "emitir");
  if (guard.error) return guard.error;

  const facturaId = Number(id);
  if (!Number.isInteger(facturaId) || facturaId <= 0) {
    return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  }
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }

  try {
  const resultado = await emitirFactura(
    { empresaId: guard.empresa.id, usuarioId: guard.session.id, usuario: guard.session.username },
    facturaId,
    { numeroFactura: parsed.data.numeroFactura ?? null, fechaEmision: parsed.data.fechaEmision ?? null, vencimientoToken: parsed.data.vencimientoToken },
  );
  if (!resultado.ok) {
    return NextResponse.json({ error: resultado.error }, { status: resultado.status });
  }
  return NextResponse.json({ mensaje: "Factura emitida." });
  } catch (e) { const r = respuestaErrorCredito(e); return NextResponse.json({ error: r.error }, { status: r.status }); }
}
