import { NextResponse } from "next/server";
import { requireTenantRrhh } from "@/lib/tenant";
import { previsualizarHistorialActual } from "@/lib/rrhh/vacaciones-historial-actual";

type Ctx = { params: Promise<{ slug: string }> };

/**
 * Previsualizar historial actual — transforma las vacaciones actuales al formato del importador y ejecuta el MISMO motor de vista
 * previa. SOLO LECTURA: no escribe nada ni acepta datos del cliente (la empresa sale del slug/sesión). Permiso: RRHH · Vacaciones · editar.
 */
export async function GET(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "vacaciones", "editar");
  if (guard.error) return guard.error;
  try {
    const resultado = await previsualizarHistorialActual(guard.empresa.id);
    return NextResponse.json(resultado, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("[vacaciones/exportar-historial/preview]", error);
    return NextResponse.json({ error: "No se pudo generar la vista previa del historial actual." }, { status: 500 });
  }
}
