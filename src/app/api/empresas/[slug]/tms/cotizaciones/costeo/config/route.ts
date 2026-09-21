import { NextResponse } from "next/server";
import { requireTenantCotizacionesCosteo } from "@/lib/tenant";
import { ErrorCosteoConfig, listarPerfilesCosteo, obtenerParametrosCosteoVigentes } from "@/lib/tms/cotizacion-costeo-db";

type Ctx = { params: Promise<{ slug: string }> };
const NO_STORE = { "Cache-Control": "private, no-store" };
const hoyGuatemala = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Guatemala" }).format(new Date());

/**
 * COTIZACIONES-COSTEO — configuración del costeo (perfiles activos +
 * parámetros vigentes). YA expone costos internos (combustible, salarios,
 * viáticos, margen): guard exclusivo cotizaciones_costeo:ver, nunca
 * requireTenantCotizaciones. Sin permiso => 403 y la UI oculta la sección.
 */
export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantCotizacionesCosteo(slug, "ver");
  if (guard.error) {
    guard.error.headers.set("Cache-Control", "private, no-store");
    return guard.error;
  }
  const fechaParam = new URL(req.url).searchParams.get("fecha");
  const fecha = fechaParam && /^\d{4}-\d{2}-\d{2}$/.test(fechaParam) ? fechaParam : hoyGuatemala();
  try {
    const [perfiles, vigentes] = await Promise.all([
      listarPerfilesCosteo(guard.empresa.id),
      obtenerParametrosCosteoVigentes(guard.empresa.id, fecha),
    ]);
    return NextResponse.json(
      { perfiles, parametros: { vigenteDesde: vigentes.vigenteDesde, ...vigentes.parametros } },
      { headers: NO_STORE },
    );
  } catch (error) {
    if (error instanceof ErrorCosteoConfig) return NextResponse.json({ error: error.message }, { status: 409, headers: NO_STORE });
    return NextResponse.json({ error: "No se pudo cargar la configuración del costeo." }, { status: 500, headers: NO_STORE });
  }
}
