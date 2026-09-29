import { NextResponse } from "next/server";
import { requireTenantRrhh } from "@/lib/tenant";
import { listarPuestosDisponibles } from "@/lib/rrhh/entrevistas";

type Ctx = { params: Promise<{ slug: string }> };

/**
 * GET /api/empresas/[slug]/rrhh/entrevistas/puestos
 * ATRACCION-TALENTO-2 (sección 12) — catálogo REAL de puestos de esta
 * empresa (empleados.puesto + puestos ya usados en entrevistas), NO la lista
 * estática PUESTOS_MONACO. Guard: entrevistas:ver. Tenant siempre desde
 * guard.empresa.id.
 */
export async function GET(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "entrevistas", "ver");
  if (guard.error) return guard.error;

  const puestos = await listarPuestosDisponibles(guard.empresa.id);
  return NextResponse.json(
    { puestos },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
