import { NextResponse } from "next/server";
import { requireTenantRrhh } from "@/lib/tenant";
import { previsualizarActivacionModoHistorico } from "@/lib/rrhh/vacaciones-modo-preflight-db";

type Ctx = { params: Promise<{ slug: string }> };

/**
 * PREFLIGHT de la activación del modo de carga histórica (SOLO LECTURA): revisa a todos los colaboradores de la empresa y responde cuántos están aptos y cuáles tienen consumo que
 * no puede reconstruirse de forma verificable (con su motivo). No escribe nada. La empresa sale del slug/sesión. Permiso: RRHH · Configuración · editar (el mismo que activa el modo).
 */
export async function GET(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "configuracion", "editar");
  if (guard.error) return guard.error;
  try {
    return NextResponse.json(await previsualizarActivacionModoHistorico(guard.empresa.id), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("[rrhh/vacaciones/modo-carga-historica/preflight]", error);
    return NextResponse.json({ error: "No se pudo verificar el consumo histórico. No se puede activar el modo." }, { status: 500 });
  }
}
