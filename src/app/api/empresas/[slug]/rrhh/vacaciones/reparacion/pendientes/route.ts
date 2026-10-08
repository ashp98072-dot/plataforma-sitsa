import { NextResponse } from "next/server";
import { requireTenantRrhh } from "@/lib/tenant";
import { listarPendientesReparacion } from "@/lib/rrhh/vacaciones-reparacion-db";

type Ctx = { params: Promise<{ slug: string }> };

/**
 * Colaboradores de la empresa cuya serie de vacaciones requiere reparación administrada. SOLO LECTURA: identifica, no repara (la reparación es
 * uno por uno, con vista previa). La empresa sale del slug/sesión. Permiso: RRHH · Vacaciones · editar.
 */
export async function GET(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "vacaciones", "editar");
  if (guard.error) return guard.error;
  try {
    return NextResponse.json(await listarPendientesReparacion(guard.empresa.id), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("[rrhh/vacaciones/reparacion/pendientes]", error);
    return NextResponse.json({ error: "No se pudo calcular el listado." }, { status: 500 });
  }
}
