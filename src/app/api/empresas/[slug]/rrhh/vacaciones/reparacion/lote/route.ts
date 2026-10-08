import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantRrhh } from "@/lib/tenant";
import { repararLoteVacaciones } from "@/lib/rrhh/vacaciones-reparacion-db";

type Ctx = { params: Promise<{ slug: string }> };

const MAX_LOTE = 500;
// Solo ids y huellas de la vista previa confirmada, más la confirmación explícita. Empresa, usuario y fecha de alta salen SIEMPRE del servidor.
const schema = z.object({
  confirmar: z.literal(true),
  empleados: z.array(z.object({ empleadoId: z.number().int().positive().max(2147483647), huella: z.string().regex(/^[0-9a-f]{32}$/) })).min(1).max(MAX_LOTE),
});

/**
 * Reparación POR LOTE de las series de vacaciones: ejecuta la reparación individual de #423 para cada colaborador indicado, cada uno en SU PROPIA
 * transacción (re-valida todo bajo FOR UPDATE y exige que la huella coincida con la vista previa). Un bloqueo/cambio/error en uno no afecta a los
 * demás. Solo con confirmación explícita (`confirmar: true`). Permiso: RRHH · Vacaciones · editar.
 */
export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "vacaciones", "editar");
  if (guard.error) return guard.error;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Falta la confirmación explícita o la lista de colaboradores con su huella de la vista previa." }, { status: 400 });
  try {
    const r = await repararLoteVacaciones(guard.empresa.id, parsed.data.empleados, { usuario: guard.session.username });
    return NextResponse.json(r, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("[rrhh/vacaciones/reparacion/lote]", error);
    return NextResponse.json({ error: "No se pudo ejecutar el lote." }, { status: 500 });
  }
}
