import { NextResponse } from "next/server";
import { requireTenantRrhh } from "@/lib/tenant";
import { crearDescuentoDesdeMulta } from "@/lib/multas/backend";
import { errorMultas } from "@/lib/multas/http";
import { idSchema } from "@/lib/multas/reglas";

type Ctx = { params: Promise<{ slug: string; multaId: string }> };

/**
 * MULTAS-3.2 (secciones 8, 10, 11, 14) — RRHH configura periodicidad/
 * cuotas/fecha y, en una sola transacción, crea + autoriza el descuento
 * real (reutilizando el motor de RRHH tal cual) y vincula
 * ops_multas.rrhh_descuento_id. Exige rrhh:descuentos:crear — multas:editar
 * por sí solo NUNCA basta.
 */
export async function POST(req: Request, ctx: Ctx) {
  try {
    const { slug, multaId } = await ctx.params;
    const guard = await requireTenantRrhh(slug, "descuentos", "crear");
    if (guard.error) return guard.error;
    return NextResponse.json(
      await crearDescuentoDesdeMulta(
        { empresaId: guard.empresa.id, usuarioId: guard.session.id, usuario: guard.session.username },
        idSchema.parse(multaId),
        await req.json(),
      ),
      { status: 201 },
    );
  } catch (error) { return errorMultas(error); }
}
