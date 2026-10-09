import { NextResponse } from "next/server";
import { requireTenantFacturacion } from "@/lib/tenant";
import { listarViajesPendientes } from "@/lib/facturacion/facturas";

type Ctx = { params: Promise<{ slug: string }> };
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * FACT-1/FACT-2 — viajes FACTURABLES: Cerrados, con cliente vinculado, tarifa
 * comercial y ruta/destino válidos, y sin ninguna factura viva asociada. Guard
 * `facturacion:ver` — NUNCA `tms:ver`. Devuelve SOLO lo que Facturación
 * necesita (fecha/código/cliente/ruta/origen/destino/placa/nombre del piloto/
 * tarifa/moneda/fecha de cierre) — nunca auxiliares/evidencias/paradas/GPS (ver
 * src/lib/facturacion/facturas.ts, listarViajesPendientes). Filtros: clienteId,
 * fechaDesde/fechaHasta, ruta (código o destino). El estado siempre es Cerrado
 * y la empresa siempre es la de la sesión: no son filtros.
 */
export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantFacturacion(slug, "ver");
  if (guard.error) return guard.error;

  const p = new URL(req.url).searchParams;
  const clienteId = Number(p.get("clienteId"));
  const page = Number(p.get("page"));
  const pageSize = Number(p.get("pageSize"));
  const resultado = await listarViajesPendientes(guard.empresa.id, {
    clienteId: Number.isInteger(clienteId) && clienteId > 0 ? clienteId : undefined,
    fechaDesde: p.get("fechaDesde") && FECHA_RE.test(p.get("fechaDesde")!) ? p.get("fechaDesde")! : undefined,
    fechaHasta: p.get("fechaHasta") && FECHA_RE.test(p.get("fechaHasta")!) ? p.get("fechaHasta")! : undefined,
    ruta: p.get("ruta")?.trim().slice(0, 80) || undefined,
    page: Number.isInteger(page) && page > 0 ? page : undefined,
    pageSize: Number.isInteger(pageSize) && pageSize > 0 ? pageSize : undefined,
  });
  return NextResponse.json(
    { viajes: resultado.items, totalReal: resultado.totalReal, page: resultado.page, pageSize: resultado.pageSize },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
