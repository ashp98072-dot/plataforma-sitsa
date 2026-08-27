import { NextResponse } from "next/server";
import { requireTenantMultas, requireTenantRrhh } from "@/lib/tenant";
import { anularMultaConDescuentoVinculado } from "@/lib/multas/backend";
import { errorMultas } from "@/lib/multas/http";
import { idSchema } from "@/lib/multas/reglas";

type Ctx = { params: Promise<{ slug: string; id: string }> };

/**
 * MULTAS-3.2 (sección 16) — anular una multa que YA tiene rrhh_descuento_id
 * vinculado. El PATCH genérico ({accion:"anular"}) rechaza este caso
 * (ver el guard de transicion() en reglas.ts); esta es la única vía para
 * anularla, y decide sola (sin cuotas APLICADA: cancela el descuento y
 * anula; con al menos una: 409).
 *
 * Corrección P1 (revisión de permisos del PR): esta acción ejecuta
 * cancelarDescuentoInterno() — cancelar un descuento es autoridad de RRHH
 * (regla congelada: RRHH controla descuento real/cuotas/autorización/
 * cancelación; Operaciones solo decide responsabilidad/resolución/
 * montos), no de Operaciones por sí sola. Por eso exige AMBOS permisos
 * efectivos en el mismo usuario — multas:editar (decide anular la multa)
 * Y rrhh:descuentos:editar (autoriza cancelar el descuento vinculado) —
 * sin introducir un flujo nuevo en esta fase: sigue siendo una sola
 * transacción atómica, solo que ahora requiere doble autoridad para
 * dispararla.
 */
export async function POST(req: Request, ctx: Ctx) {
  try {
    const { slug, id } = await ctx.params;
    const guardMultas = await requireTenantMultas(slug, "editar");
    if (guardMultas.error) return guardMultas.error;
    const guardRrhh = await requireTenantRrhh(slug, "descuentos", "editar");
    if (guardRrhh.error) return guardRrhh.error;
    const body = await req.json().catch(() => ({}));
    return NextResponse.json(
      await anularMultaConDescuentoVinculado(
        { empresaId: guardMultas.empresa.id, usuarioId: guardMultas.session.id, usuario: guardMultas.session.username },
        idSchema.parse(id),
        String((body as { motivo_anulacion?: unknown }).motivo_anulacion ?? ""),
      ),
    );
  } catch (error) { return errorMultas(error); }
}
