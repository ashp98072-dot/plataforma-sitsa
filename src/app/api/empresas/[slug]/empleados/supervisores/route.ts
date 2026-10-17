import { NextResponse } from "next/server";
import { requireTenantRrhh } from "@/lib/tenant";
import { listarCatalogoSupervisores } from "@/lib/rrhh/supervisores-catalogo";

type Ctx = { params: Promise<{ slug: string }> };
export async function GET(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "empleados", "ver");
  if (guard.error) return guard.error;
  const empleados = await listarCatalogoSupervisores(guard.empresa.id);
  return NextResponse.json({ empleados }, { headers: { "Cache-Control": "private, no-store" } });
}
