import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantFacturacion } from "@/lib/tenant";
import { listarPagos, registrarPago } from "@/lib/facturacion/facturas";

type Ctx = { params: Promise<{ slug: string; id: string }> };
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
const schema = z.object({
  fechaPago: z.string().regex(FECHA_RE),
  monto: z.number().positive(),
  referencia: z.string().trim().max(120).optional().nullable(),
  medioPago: z.string().trim().max(40).optional().nullable(),
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

  const pagos = await listarPagos(guard.empresa.id, facturaId);
  return NextResponse.json({ pagos }, { headers: { "Cache-Control": "private, no-store" } });
}

/** Solo contra factura Emitida. Rechaza sobrepago (monto > saldo). facturacion:crear. */
export async function POST(req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireTenantFacturacion(slug, "crear");
  if (guard.error) return guard.error;

  const facturaId = idValido(id);
  if (!facturaId) return NextResponse.json({ error: "ID inválido." }, { status: 400 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos de pago inválidos." }, { status: 400 });
  }
  const d = parsed.data;

  const resultado = await registrarPago(
    { empresaId: guard.empresa.id, usuarioId: guard.session.id, usuario: guard.session.username },
    facturaId,
    {
      fechaPago: d.fechaPago,
      monto: d.monto,
      referencia: d.referencia ?? null,
      medioPago: d.medioPago ?? null,
      observaciones: d.observaciones ?? null,
    },
  );
  if (!resultado.ok) {
    return NextResponse.json({ error: resultado.error }, { status: resultado.status });
  }
  return NextResponse.json({ mensaje: "Pago registrado." }, { status: 201 });
}
