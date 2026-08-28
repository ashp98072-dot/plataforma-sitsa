import { NextResponse } from "next/server";
import { requireTenantFacturacion } from "@/lib/tenant";
import { listarViajesPendientes } from "@/lib/facturacion/facturas";

type Ctx = { params: Promise<{ slug: string }> };
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * FACT-1 — viajes Cerrados sin ninguna factura viva asociada. Guard
 * `facturacion:ver` — NUNCA `tms:ver`. Devuelve SOLO lo que Facturador
 * necesita (fecha/código/cliente/placa/tarifa/fecha de cierre) — nunca
 * piloto/auxiliares/evidencias/paradas/GPS (ver src/lib/facturacion/
 * facturas.ts, listarViajesPendientes).
 */
export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantFacturacion(slug, "ver");
  if (guard.error) return guard.error;

  const p = new URL(req.url).searchParams;
  const clienteId = Number(p.get("clienteId"));
  const viajes = await listarViajesPendientes(guard.empresa.id, {
    clienteId: Number.isInteger(clienteId) && clienteId > 0 ? clienteId : undefined,
    fechaDesde: p.get("fechaDesde") && FECHA_RE.test(p.get("fechaDesde")!) ? p.get("fechaDesde")! : undefined,
    fechaHasta: p.get("fechaHasta") && FECHA_RE.test(p.get("fechaHasta")!) ? p.get("fechaHasta")! : undefined,
  });
  return NextResponse.json({ viajes }, { headers: { "Cache-Control": "private, no-store" } });
}
