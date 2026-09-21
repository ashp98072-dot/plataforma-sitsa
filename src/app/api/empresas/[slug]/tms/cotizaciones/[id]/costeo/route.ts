import { NextResponse } from "next/server";
import { requireTenantCotizacionesCosteo } from "@/lib/tenant";
import { obtenerCotizacion } from "@/lib/tms/cotizaciones";
import { obtenerSnapshotCosteo } from "@/lib/tms/cotizacion-costeo-db";

type Ctx = { params: Promise<{ slug: string; id: string }> };
const NO_STORE = { "Cache-Control": "private, no-store" };

/**
 * COTIZACIONES-COSTEO — lectura del snapshot histórico de una cotización.
 * Guard: cotizaciones_costeo:ver. Esta información NUNCA viaja en el GET
 * normal de cotización, en el listado ni en el PDF comercial.
 */
export async function GET(_req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireTenantCotizacionesCosteo(slug, "ver");
  if (guard.error) {
    guard.error.headers.set("Cache-Control", "private, no-store");
    return guard.error;
  }
  if (!/^[1-9]\d*$/.test(id) || Number(id) > 2147483647) return NextResponse.json({ error: "Cotización no encontrada." }, { status: 404, headers: NO_STORE });
  const cotizacionId = Number(id);
  const cotizacion = await obtenerCotizacion(guard.empresa.id, cotizacionId);
  if (!cotizacion) return NextResponse.json({ error: "Cotización no encontrada." }, { status: 404, headers: NO_STORE });
  const costeo = await obtenerSnapshotCosteo(guard.empresa.id, cotizacionId);
  if (!costeo) return NextResponse.json({ error: "Esta cotización no tiene costeo registrado." }, { status: 404, headers: NO_STORE });
  return NextResponse.json({ costeo }, { headers: NO_STORE });
}
