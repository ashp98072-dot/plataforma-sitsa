import { NextResponse } from "next/server";
import { requireTenantViajesCerrar } from "@/lib/tenant";
import { cerrarViaje } from "@/lib/tms/cierre-viaje";

type Ctx = { params: Promise<{ slug: string; id: string }> };

/**
 * OPS-1 — cierre administrativo del viaje: Descargado -> Cerrado.
 * Permiso EXPLÍCITO `viajes_cerrar:editar` (requireTenantViajesCerrar) —
 * NUNCA por rol (ni "JefeOperaciones" ni ningún otro nombre de rol es
 * autoridad aquí, solo el permiso). El piloto no tiene acceso a este
 * endpoint (vive fuera de /api/portal); Auxiliar de Operaciones y
 * Facturador tampoco lo tienen por defecto — ver
 * src/lib/permisos-shared.ts.
 */
export async function POST(_req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireTenantViajesCerrar(slug, "editar");
  if (guard.error) return guard.error;

  const planId = Number(id);
  if (!Number.isFinite(planId)) {
    return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  }

  const r = await cerrarViaje(guard.empresa.id, planId, guard.session.username);
  if (!r.ok) {
    return NextResponse.json({ error: r.error }, { status: 409 });
  }
  return NextResponse.json({ mensaje: "Viaje cerrado." });
}
