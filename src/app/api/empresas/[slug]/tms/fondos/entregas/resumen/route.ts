import { NextResponse } from "next/server";
import { requireTenantEntregas } from "@/lib/tenant";
import { respuestaFalloOperacion } from "@/lib/entregas/http";
import { MAX_IDS_RESUMEN, resumenEntregasDocumentos } from "@/lib/entregas/resumen";

type Ctx = { params: Promise<{ slug: string }> };

/**
 * Resumen de entrega (custodia, pendiente) de las solicitudes del listado en UNA consulta: `?ids=1,2,3`. Acotado a la empresa
 * de la sesión; un id ajeno devuelve la custodia inicial sin revelar nada. Sin polling.
 */
export async function GET(req: Request, ctx: Ctx) {
  try {
    const { slug } = await ctx.params;
    const guard = await requireTenantEntregas(slug, { aceptaGastosVer: true });
    if (guard.error) return guard.error;
    const ids = (new URL(req.url).searchParams.get("ids") ?? "")
      .split(",").map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0).slice(0, MAX_IDS_RESUMEN);
    return NextResponse.json({ resumen: await resumenEntregasDocumentos(guard.empresa.id, "FONDOS", ids) });
  } catch (error) {
    return respuestaFalloOperacion(error, "GET tms/fondos/entregas/resumen");
  }
}
