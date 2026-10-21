import { NextResponse } from "next/server";
import { requireTenantRrhh } from "@/lib/tenant";
import { previsualizarReparacionLote } from "@/lib/rrhh/vacaciones-reparacion-db";

type Ctx = { params: Promise<{ slug: string }> };

/**
 * Vista previa GLOBAL de la reparación de series de vacaciones de todos los pendientes de la empresa. SOLO LECTURA: devuelve, por colaborador,
 * períodos actuales y propuestos, saldos, consumo preservado, bloqueos, estado (ELEGIBLE / BLOQUEADO / SIN_CAMBIOS) y la huella individual de los
 * elegibles. La empresa sale del slug/sesión. Permiso: RRHH · Vacaciones · editar.
 */
export async function GET(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "vacaciones", "editar");
  if (guard.error) return guard.error;
  try {
    return NextResponse.json(await previsualizarReparacionLote(guard.empresa.id), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("[rrhh/vacaciones/reparacion/lote/preview]", error);
    return NextResponse.json({ error: "No se pudo calcular la vista previa del lote." }, { status: 500 });
  }
}
