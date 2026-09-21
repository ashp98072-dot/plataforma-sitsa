import { NextResponse } from "next/server";
import { requireTenantCotizacionesCosteo } from "@/lib/tenant";
import { calcularCosteoSchema, mensajeErrorCosteo, prepararCosteo } from "@/lib/tms/cotizacion-costeo-servicio";

type Ctx = { params: Promise<{ slug: string }> };
const NO_STORE = { "Cache-Control": "private, no-store" };

/**
 * COTIZACIONES-COSTEO — calcula el costeo SIN guardar nada. Guard:
 * cotizaciones_costeo:crear o :editar (dos permisos explícitos del mismo
 * módulo; nunca tms/cotizaciones). El payload es estricto: perfil por id y
 * parámetros económicos SIEMPRE los resuelve el servidor.
 */
export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  let guard = await requireTenantCotizacionesCosteo(slug, "crear");
  if (guard.error) {
    const alterno = await requireTenantCotizacionesCosteo(slug, "editar");
    if (alterno.error) {
      guard.error.headers.set("Cache-Control", "private, no-store");
      return guard.error;
    }
    guard = alterno;
  }

  const parsed = calcularCosteoSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos de costeo no válidos." }, { status: 400, headers: NO_STORE });
  const { fechaEmision, tarifaCotizada, incluyeIva, ...payload } = parsed.data;
  try {
    const { resultado, perfil, parametrosVigenteDesde } = await prepararCosteo(guard.empresa.id, payload, { fechaEmision, tarifaCotizada, incluyeIva });
    return NextResponse.json(
      { resultado, perfil: { id: perfil.id, codigo: perfil.codigo, nombre: perfil.nombre }, parametrosVigenteDesde },
      { headers: NO_STORE },
    );
  } catch (error) {
    const mensaje = mensajeErrorCosteo(error);
    if (mensaje) return NextResponse.json({ error: mensaje }, { status: 400, headers: NO_STORE });
    return NextResponse.json({ error: "No se pudo calcular el costeo." }, { status: 500, headers: NO_STORE });
  }
}
