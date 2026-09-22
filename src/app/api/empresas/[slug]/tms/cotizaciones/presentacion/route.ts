import { NextResponse } from "next/server";
import { requireTenantCotizaciones } from "@/lib/tenant";
import { obtenerPresentacionComercial } from "@/lib/tms/cotizacion-presentacion";

type Ctx = { params: Promise<{ slug: string }> };

/**
 * Mensajes PREDETERMINADOS por marca, de solo lectura — usados por el
 * formulario de Nueva/Editar cotización para precargar "Mensaje para el
 * cliente" al elegir Documento emitido por. Mismo permiso que el resto de
 * Cotizaciones (cotizaciones:ver o tms:ver): a diferencia de
 * requireTenantCotizacionesAjustes, quien crea cotizaciones necesita ver
 * estos textos aunque no tenga acceso administrativo a Ajustes. Guardar los
 * defaults sigue exigiendo cotizaciones_ajustes (ver .../ajustes/presentacion).
 */
export async function GET(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantCotizaciones(slug, "ver");
  if (guard.error) return guard.error;

  const presentacion = await obtenerPresentacionComercial(guard.empresa.id);
  return NextResponse.json({ presentacion }, { headers: { "Cache-Control": "private, no-store" } });
}
