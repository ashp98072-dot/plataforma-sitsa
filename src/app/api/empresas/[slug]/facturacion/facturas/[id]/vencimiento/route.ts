import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireTenantFacturacion } from '@/lib/tenant';
import { obtenerFactura } from '@/lib/facturacion/facturas';
import { leerVencimiento, previsualizarVencimiento, respuestaErrorCredito } from '@/lib/facturacion/credito';
import { fechaCredito } from '@/lib/facturacion/vencimiento';
type Ctx = { params: Promise<{ slug: string; id: string }> };
const identificador = z.coerce.number().int().positive().max(2147483647);
export async function GET(_req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const g = await requireTenantFacturacion(slug, 'ver');
  if (g.error) return g.error;
  const n = identificador.safeParse(id);
  if (!n.success) return NextResponse.json({ error: 'Factura inválida.' }, { status: 400 });
  try {
    if (!await obtenerFactura(g.empresa.id, n.data)) return NextResponse.json({ error: 'Factura no encontrada.' }, { status: 404 });
    return NextResponse.json({ vencimiento: await leerVencimiento(g.empresa.id, n.data) }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (e) { const r = respuestaErrorCredito(e); return NextResponse.json({ error: r.error }, { status: r.status }); }
}
export async function POST(req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const g = await requireTenantFacturacion(slug, 'emitir');
  if (g.error) return g.error;
  const n = identificador.safeParse(id);
  const b = z.strictObject({ fechaEmision: fechaCredito }).safeParse(await req.json().catch(() => null));
  if (!n.success || !b.success) return NextResponse.json({ error: 'Solicitud inválida.' }, { status: 400 });
  try {
    const p = await previsualizarVencimiento({ empresaId: g.empresa.id, usuarioId: g.session.id, usuario: g.session.username }, n.data, b.data.fechaEmision);
    return NextResponse.json(p, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (e) { const r = respuestaErrorCredito(e); return NextResponse.json({ error: r.error }, { status: r.status }); }
}
