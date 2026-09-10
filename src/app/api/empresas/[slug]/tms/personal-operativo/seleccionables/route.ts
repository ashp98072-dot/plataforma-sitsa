import { NextResponse } from "next/server";
import { requireTenantProgramacionOTms } from "@/lib/tenant";
import { asegurarSchemaFlota } from "@/lib/flota/schema";
import { seleccionablesParaPlan, type TipoPersonal } from "@/lib/tms/personal-operativo";

type Ctx = { params: Promise<{ slug: string }> };

/**
 * PERSONAL-OPERATIVO-COMPARTIDO-EXTERNO-1 — candidatos para los selectores
 * de Piloto/Auxiliar de Programación: empleados PROPIOS activos +
 * personal COMPARTIDO/EXTERNO activo de esta empresa, en una sola lista
 * con etiqueta de fuente/origen. Reemplaza la lectura directa de
 * /rrhh/personal-ops en plan-form (que solo veía empleados propios).
 */
export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantProgramacionOTms(slug, "ver");
  if (guard.error) return guard.error;
  try { await asegurarSchemaFlota(); } catch { /* degrada abajo */ }

  const tipoRaw = new URL(req.url).searchParams.get("tipo");
  const tipo: TipoPersonal = tipoRaw === "Auxiliar" ? "Auxiliar" : "Piloto";

  try {
    const seleccionables = await seleccionablesParaPlan(guard.empresa.id, tipo);
    return NextResponse.json({ seleccionables }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ seleccionables: [] });
  }
}
