import { NextResponse } from "next/server";
import { requireTenantViaticos } from "@/lib/tenant";
import { autorizarViatico } from "@/lib/tms/viaticos";

type Ctx = { params: Promise<{ slug: string; id: string }> };

/**
 * VIAT-1 — PROGRAMADO -> AUTORIZADO. Permiso EXPLÍCITO `viaticos:editar`
 * (requireTenantViaticos), NUNCA por ser supervisor del empleado ni por
 * tener acceso general de edición a TMS — ver decisión "SUPERVISOR !=
 * APROBADOR" documentada en src/lib/tenant.ts.
 */
export async function POST(_req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireTenantViaticos(slug, "editar");
  if (guard.error) return guard.error;

  const viaticoId = Number(id);
  if (!Number.isFinite(viaticoId)) {
    return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  }

  const r = await autorizarViatico(guard.empresa.id, viaticoId, guard.session.username);
  if (!r.ok) {
    return NextResponse.json({ error: r.error }, { status: 400 });
  }
  return NextResponse.json({ mensaje: "Viático autorizado." });
}
