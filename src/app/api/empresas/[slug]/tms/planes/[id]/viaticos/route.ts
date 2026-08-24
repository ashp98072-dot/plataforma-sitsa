import { NextResponse } from "next/server";
import { requireTenantModulo } from "@/lib/tenant";
import { listarViaticosDePlan } from "@/lib/tms/viaticos";
import { permisosEfectivos, tienePermiso } from "@/lib/permisos";
import type { RolGlobal } from "@/lib/roles";

type Ctx = { params: Promise<{ slug: string; id: string }> };

/**
 * VIAT-0 (punto 8) — detalle de viáticos de un plan/viaje: cliente, viaje,
 * unidad, piloto/auxiliar, monto sugerido, monto asignado, fecha, estado,
 * quién lo modificó. Uso EXCLUSIVO de TMS/RRHH (requireTenantModulo "tms") —
 * información interna, nunca se expone en endpoints de cliente/facturación
 * (punto 4/11).
 *
 * VIAT-1 (punto 6) — se agrega `puedeGestionar`: solo informativo para que
 * la UI oculte los botones Autorizar/Registrar entrega/Liquidar a quien no
 * tiene el permiso `viaticos:editar`. La seguridad real está en los propios
 * endpoints de autorizar/entrega/liquidar (requireTenantViaticos) — este
 * flag nunca se usa para autorizar nada, solo para no mostrar botones que
 * fallarían.
 */
export async function GET(_req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireTenantModulo(slug, "tms");
  if (guard.error) return guard.error;

  const planId = Number(id);
  if (!Number.isFinite(planId)) {
    return NextResponse.json({ error: "ID de plan inválido." }, { status: 400 });
  }

  const perms = await permisosEfectivos(guard.session.id, guard.session.rol as RolGlobal);
  const puedeGestionar = tienePermiso(perms, "viaticos", "editar");

  const viaticos = await listarViaticosDePlan(guard.empresa.id, planId);
  return NextResponse.json(
    { viaticos, puedeGestionar },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
