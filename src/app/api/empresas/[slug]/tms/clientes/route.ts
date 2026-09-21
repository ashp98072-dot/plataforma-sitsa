import { NextResponse } from "next/server";
import { requireTenantCotizaciones } from "@/lib/tenant";
import { buscarClientesTms } from "@/lib/tms/clientes-busqueda";

type Ctx = { params: Promise<{ slug: string }> };

/**
 * COTIZACIONES — búsqueda remota de clientes TMS (mismo patrón que
 * GET /tms/rutas?q= para RutaSelect). Devuelve solo lo necesario para el
 * selector: `id` es `tms_clientes.id`. Sin el catálogo completo de
 * /tms/catalogos, que no debe consultarse en cada tecleo.
 *
 * Permiso: cotizaciones:ver O tms:ver (requireTenantCotizaciones) — quien puede
 * cotizar puede elegir cliente. La empresa sale de la sesión/slug, nunca del
 * cliente.
 */
export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantCotizaciones(slug, "ver");
  if (guard.error) return guard.error;

  const q = new URL(req.url).searchParams.get("q");
  try {
    const clientes = await buscarClientesTms(guard.empresa.id, q);
    return NextResponse.json({ clientes }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "No se pudieron cargar los clientes." }, { status: 500 });
  }
}
