import { NextResponse } from "next/server";
import { requireTenantRrhh } from "@/lib/tenant";
import { listarHorasExtraAdmin, type FiltroEstadoHorasExtra } from "@/lib/rrhh/horas-extra";

type Ctx = { params: Promise<{ slug: string }> };

const ESTADOS_VALIDOS = ["PENDIENTE", "APROBADA", "RECHAZADA", "APLICADA_EN_PLANILLA", "TODOS"];

/**
 * Fase H1 — bandeja administrativa RRHH: lista TODOS los registros de horas
 * extra de la empresa (no solo los de un supervisor), con filtro de estado.
 * El registro sigue siendo exclusivo del Portal del supervisor — este
 * endpoint es de solo lectura (la aprobación/rechazo vive en [id]/route.ts).
 */
export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "horas_extra", "ver");
  if (guard.error) return guard.error;

  const url = new URL(req.url);
  const estadoParam = url.searchParams.get("estado") ?? "TODOS";
  const estado: FiltroEstadoHorasExtra = ESTADOS_VALIDOS.includes(estadoParam)
    ? (estadoParam as FiltroEstadoHorasExtra)
    : "TODOS";

  try {
    const registros = await listarHorasExtraAdmin(guard.empresa.id, estado);
    return NextResponse.json(
      { registros },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    console.error("GET rrhh/horas-extra", e);
    return NextResponse.json({
      registros: [],
      aviso: "No se pudo leer horas extra. Verifica que la migración de H1 esté aplicada.",
    });
  }
}
