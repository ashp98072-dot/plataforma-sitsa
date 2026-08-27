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
 * ops_multas.rrhh_descuento_id. multas:editar por sí solo NUNCA basta.
 *
 * Corrección P0 (revisión de permisos del PR): esta acción hace DOS cosas
 * de RRHH, no una — crea el descuento (crearDescuentoInterno) Y lo
 * autoriza (autorizarDescuentoInterno), que en el flujo normal de RRHH
 * (src/app/api/empresas/[slug]/rrhh/descuentos) son dos permisos
 * distintos: crear (POST) y editar (PATCH "autorizar"). Por eso exige
 * AMBOS permisos efectivos — rrhh:descuentos:crear Y rrhh:descuentos:editar
 * — en el mismo usuario. Dos llamadas explícitas al mismo guard ya
 * existente (requireTenantRrhh) es la forma más pequeña de expresarlo,
 * sin duplicar su lógica ni crear un helper nuevo solo para esto.
 */
export async function POST(req: Request, ctx: Ctx) {
  try {
    const { slug, multaId } = await ctx.params;
    const guardCrear = await requireTenantRrhh(slug, "descuentos", "crear");
    if (guardCrear.error) return guardCrear.error;
    const guardEditar = await requireTenantRrhh(slug, "descuentos", "editar");
    if (guardEditar.error) return guardEditar.error;
    return NextResponse.json(
      await crearDescuentoDesdeMulta(
        { empresaId: guardCrear.empresa.id, usuarioId: guardCrear.session.id, usuario: guardCrear.session.username },
        idSchema.parse(multaId),
        await req.json(),
      ),
      { status: 201 },
    );
  } catch (error) { return errorMultas(error); }
}
