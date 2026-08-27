import { NextResponse } from "next/server";
import { requireTenantMultas } from "@/lib/tenant";
import { anularMultaConDescuentoVinculado } from "@/lib/multas/backend";
import { errorMultas } from "@/lib/multas/http";
import { idSchema } from "@/lib/multas/reglas";

type Ctx = { params: Promise<{ slug: string; id: string }> };

/**
 * MULTAS-3.2 (sección 16) — anular una multa que YA tiene rrhh_descuento_id
 * vinculado. El PATCH genérico ({accion:"anular"}) rechaza este caso
 * (ver el guard de transicion() en reglas.ts); esta es la única vía para
 * anularla, y decide sola (sin cuotas APLICADA: cancela el descuento y
 * anula; con al menos una: 409). Mismo permiso que el resto de escrituras
 * de Operaciones sobre Multas — la cancelación del descuento es un efecto
 * controlado de una decisión de Operaciones, no una decisión nueva de RRHH.
 */
export async function POST(req: Request, ctx: Ctx) {
  try {
    const { slug, id } = await ctx.params;
    const guard = await requireTenantMultas(slug, "editar");
    if (guard.error) return guard.error;
    const body = await req.json().catch(() => ({}));
    return NextResponse.json(
      await anularMultaConDescuentoVinculado(
        { empresaId: guard.empresa.id, usuarioId: guard.session.id, usuario: guard.session.username },
        idSchema.parse(id),
        String((body as { motivo_anulacion?: unknown }).motivo_anulacion ?? ""),
      ),
    );
  } catch (error) { return errorMultas(error); }
}
