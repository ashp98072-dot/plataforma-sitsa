import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantRrhh } from "@/lib/tenant";
import { resincronizarSaldosEmpresa } from "@/lib/rrhh/vacaciones-modo-resync-db";

type Ctx = { params: Promise<{ slug: string }> };

const schema = z.object({ confirmar: z.literal(true) });

/**
 * Resincronización ADMINISTRADA de los saldos persistidos con el modo vigente: sincroniza colaborador por colaborador (cada uno en su propia transacción, con la sincronización
 * normal de períodos). No es un UPDATE masivo: no borra historial ni crea vacaciones/incidencias, y puede completar períodos faltantes mediante la sincronización normal. En modo carga, un colaborador con consumo no verificable no se recalcula (`CONSUMO_NO_VERIFICABLE`). Requiere confirmación explícita y RRHH · Configuración · editar.
 */
export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "configuracion", "editar");
  if (guard.error) return guard.error;
  if (!schema.safeParse(await req.json().catch(() => null)).success) return NextResponse.json({ error: "Falta la confirmación explícita." }, { status: 400 });
  try {
    return NextResponse.json(await resincronizarSaldosEmpresa(guard.empresa.id, { usuario: guard.session.username }), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("[rrhh/vacaciones/modo-carga-historica/resincronizar]", error);
    return NextResponse.json({ error: "No se pudo resincronizar." }, { status: 500 });
  }
}
