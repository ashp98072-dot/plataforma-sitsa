import { NextResponse } from "next/server";
import { requireTenantRrhh } from "@/lib/tenant";
import { listarCatalogoEmpleadosVacaciones } from "@/lib/rrhh/vacaciones-empleados-catalogo";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  // Vacaciones antes consultaba /empleados: conservar EXACTAMENTE su permiso.
  const guard = await requireTenantRrhh(slug, "empleados", "ver");
  if (guard.error) return guard.error;
  const empleados = await listarCatalogoEmpleadosVacaciones(guard.empresa.id);
  return NextResponse.json({ empleados }, { headers: { "Cache-Control": "private, no-store" } });
}
