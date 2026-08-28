import { NextResponse } from "next/server";
import { requireTenantProgramacionOTms } from "@/lib/tenant";
import { obtenerReporteViajePorId } from "@/lib/tms/reportes-viajes";
import { reporteViajePdf } from "@/lib/tms/reporte-viaje-pdf";

type Ctx = { params: Promise<{ slug: string; id: string }> };

/** TMS-REPORTES-1 (Fase K) — expediente individual del viaje en PDF. */
export async function GET(_req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireTenantProgramacionOTms(slug, "ver");
  if (guard.error) return guard.error;

  const planId = Number(id);
  if (!Number.isInteger(planId) || planId <= 0) {
    return NextResponse.json({ error: "ID de plan inválido." }, { status: 400 });
  }
  const plan = await obtenerReporteViajePorId(guard.empresa.id, planId);
  if (!plan) {
    return NextResponse.json({ error: "Plan no encontrado." }, { status: 404 });
  }

  const buffer = await reporteViajePdf(guard.empresa.nombre, plan);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="viaje-${plan.codigo}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
