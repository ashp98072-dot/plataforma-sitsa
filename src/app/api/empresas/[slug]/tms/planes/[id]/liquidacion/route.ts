import { NextResponse } from "next/server";
import { requireTenantProgramacionOTms } from "@/lib/tenant";
import { getPool } from "@/lib/db";
import { leerLiquidacionPlan, listarEventosLiquidacion } from "@/lib/tms/liquidacion-viaje";
import { construirSnapshotOperativo } from "@/lib/tms/liquidacion-viaje-snapshot";
import { respuestaDeExcepcion } from "@/lib/validacion-formulario";

type Ctx = { params: Promise<{ slug: string; id: string }> };

/**
 * LIQUIDACIÓN DE VIAJES, FASE 3 — lectura de la liquidación vigente, su historial append-only y, mientras el viaje esté
 * pendiente de liquidar (REPORTE_RECIBIDO / EN_AJUSTE), la VISTA PREVIA de lo que se congelará como snapshot.
 *
 * Solo lectura; misma visibilidad que el listado de viajes (programacion:ver o tms:ver). La empresa sale de la sesión; un viaje
 * de otra empresa es 404. No expone costos, cargos ni datos de otros módulos.
 */
export async function GET(_req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireTenantProgramacionOTms(slug, "ver");
  if (guard.error) return guard.error;

  const planId = Number(id);
  if (!Number.isInteger(planId) || planId <= 0) {
    return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  }
  try {
    const empresaId = guard.empresa.id;
    const [liquidacion, eventos, vistaPreviaBase] = await Promise.all([
      leerLiquidacionPlan(empresaId, planId),
      listarEventosLiquidacion(empresaId, planId),
      construirSnapshotOperativo(getPool(), empresaId, planId),
    ]);
    if (!vistaPreviaBase) return NextResponse.json({ error: "Viaje no encontrado." }, { status: 404 });
    const pendiente = liquidacion && (liquidacion.estado === "REPORTE_RECIBIDO" || liquidacion.estado === "EN_AJUSTE");
    return NextResponse.json({
      liquidacion,
      eventos,
      vistaPrevia: pendiente ? vistaPreviaBase : null,
    });
  } catch (e) {
    const f = respuestaDeExcepcion(e);
    return NextResponse.json(f.cuerpo, { status: f.status });
  }
}
