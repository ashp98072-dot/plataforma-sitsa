import { NextResponse } from "next/server";
import { requireTenantProgramacionOTms } from "@/lib/tenant";
import { listarAuditoriaPlan } from "@/lib/auditoria";

type Ctx = { params: Promise<{ slug: string; id: string }> };

/**
 * OPS-AJUSTES (secciones 4-5) — "Bitácora del viaje": lee la auditoría
 * ya existente (registrarAuditoria en planes/route.ts) filtrada por
 * este plan. Mismo permiso de lectura que el resto de Programación
 * (programacion:ver O tms:ver) — no se crea un permiso ni una tabla
 * nuevos.
 */
export async function GET(_req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireTenantProgramacionOTms(slug);
  if (guard.error) return guard.error;

  const planId = Number(id);
  if (!Number.isFinite(planId)) {
    return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  }

  const eventos = await listarAuditoriaPlan(guard.empresa.id, planId);
  return NextResponse.json(
    { eventos },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
