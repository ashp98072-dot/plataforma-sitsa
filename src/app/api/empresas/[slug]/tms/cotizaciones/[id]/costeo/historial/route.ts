import { NextResponse } from "next/server";
import { requireTenantCotizacionesCosteo } from "@/lib/tenant";
import { obtenerCotizacion } from "@/lib/tms/cotizaciones";
import { listarHistorialCosteos } from "@/lib/tms/cotizacion-costeo-db";

type Ctx = { params: Promise<{ slug: string; id: string }> };
const NO_STORE = { "Cache-Control": "private, no-store" };

/**
 * COTIZACIONES — HISTORIAL DE COSTEOS: todas las versiones de la cotización (más reciente primero), tal como quedaron guardadas
 * (perfil/parámetros/input/resultado snapshot + componentes). Nunca usa la configuración viva. Solo lectura, también con la cotización
 * enviada. Guard: cotizaciones_costeo:ver (el mismo que ya protegía el costeo interno).
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
  const historial = await listarHistorialCosteos(guard.empresa.id, cotizacionId);
  return NextResponse.json({ historial }, { headers: NO_STORE });
}
