import { NextResponse } from "next/server";
import { requireTenantRrhh } from "@/lib/tenant";
import { listarMultasPendientesDescuento } from "@/lib/multas/backend";
import { errorMultas } from "@/lib/multas/http";

type Ctx = { params: Promise<{ slug: string }> };

/**
 * MULTAS-3.2 (sección 9) — bandeja RRHH: multas resueltas a cargo del
 * colaborador (COLABORADOR/COMPARTIDO, monto_colaborador > 0) que todavía
 * no tienen un descuento real vinculado. Protegida por RRHH real
 * (rrhh:descuentos:ver) — multas:ver NUNCA es autoridad suficiente aquí
 * (sección 11).
 */
export async function GET(req: Request, ctx: Ctx) {
  try {
    const { slug } = await ctx.params;
    const guard = await requireTenantRrhh(slug, "descuentos", "ver");
    if (guard.error) return guard.error;
    return NextResponse.json(
      await listarMultasPendientesDescuento(guard.empresa.id, Object.fromEntries(new URL(req.url).searchParams)),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) { return errorMultas(error); }
}
