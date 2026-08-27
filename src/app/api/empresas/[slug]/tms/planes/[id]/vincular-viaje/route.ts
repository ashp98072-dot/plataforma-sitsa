import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantProgramacionOTms } from "@/lib/tenant";
import { listarViajesCandidatosParaPlan, vincularViajeAPlan } from "@/lib/tms/vincular-viaje-plan";

type Ctx = { params: Promise<{ slug: string; id: string }> };

/**
 * PORTAL-HARDENING-2 (corrección final PR #107 — último hallazgo de
 * integridad): herramienta ADMINISTRATIVA para vincular
 * flota_viajes.plan_id → tms_planes_viaje.id cuando el auto-vínculo
 * estricto del Portal no encontró una coincidencia segura. Permiso
 * `programacion:editar` O `tms:editar` (ninguno nuevo) — nunca invocable
 * por el piloto (vive fuera de /api/portal). NO cambia el estado del plan
 * ni del viaje — ver src/lib/tms/vincular-viaje-plan.ts para el criterio
 * exacto y el backfill idempotente de evidencia.
 */

const bodySchema = z.object({ viajeId: z.number().int().positive() });

/** Lista viajes técnicos candidatos (mismo piloto/unidad/fecha, sin plan_id) para este plan. */
export async function GET(_req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireTenantProgramacionOTms(slug, "editar");
  if (guard.error) return guard.error;

  const planId = Number(id);
  if (!Number.isFinite(planId)) {
    return NextResponse.json({ error: "ID de plan inválido." }, { status: 400 });
  }
  const candidatos = await listarViajesCandidatosParaPlan(guard.empresa.id, planId);
  return NextResponse.json(
    { candidatos },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function POST(req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireTenantProgramacionOTms(slug, "editar");
  if (guard.error) return guard.error;

  const planId = Number(id);
  if (!Number.isFinite(planId)) {
    return NextResponse.json({ error: "ID de plan inválido." }, { status: 400 });
  }
  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Indica el viaje técnico a vincular." }, { status: 400 });
  }

  const r = await vincularViajeAPlan(guard.empresa.id, planId, parsed.data.viajeId, guard.session.username);
  if (!r.ok) {
    return NextResponse.json({ error: r.error }, { status: r.status });
  }
  return NextResponse.json({
    mensaje: `Viaje técnico #${parsed.data.viajeId} vinculado al plan ${r.planCodigo}.${
      r.evidenciasSincronizadas ? ` ${r.evidenciasSincronizadas} evidencia(s) sincronizada(s) a TMS.` : ""
    }`,
    evidenciasSincronizadas: r.evidenciasSincronizadas,
  });
}
