import { NextResponse } from "next/server";
import { requireTenantFacturacion } from "@/lib/tenant";
import { ErrorAntiguedad, listarAntiguedadCxc } from "@/lib/facturacion/antiguedad-cxc";
import { filtrosAntiguedadDesdeParams } from "@/lib/facturacion/antiguedad-cxc-shared";
import { listarEntidadesEmisoras } from "@/lib/facturacion/contexto-factura";

type Ctx = { params: Promise<{ slug: string }> };

/**
 * MIL-CXC-ANT-01 — Antigüedad de saldos (desde emisión, NO morosidad). SOLO LECTURA.
 * Permiso: `facturacion:ver`; la empresa sale de la sesión, nunca de la query string.
 */
export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantFacturacion(slug, "ver");
  if (guard.error) return guard.error;
  const filtros = filtrosAntiguedadDesdeParams(new URL(req.url).searchParams);
  try {
    const [resultado, entidades] = await Promise.all([listarAntiguedadCxc(guard.empresa.id, filtros), listarEntidadesEmisoras(guard.empresa.id)]);
    return NextResponse.json({ ...resultado, entidades }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    if (e instanceof ErrorAntiguedad) return NextResponse.json({ error: e.message, codigo: e.codigo }, { status: e.status });
    console.error("[cxc-antiguedad]", { code: (e as { code?: string })?.code ?? "desconocido" });
    return NextResponse.json({ error: "No se pudo generar el reporte. Intenta nuevamente." }, { status: 500 });
  }
}
