import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantGastosOperativosAutorizar } from "@/lib/tenant";
import { ErrorGasto, MENSAJE_FIRMA_REQUERIDA_AUTORIZAR, autorizarGasto } from "@/lib/tms/gastos";
import { leerBytesFirmaGuardada } from "@/lib/firmas/usuario-firmas";

type Ctx = { params: Promise<{ slug: string; id: string }> };

/**
 * GASTOS-ADMINISTRATIVO-1 (Fase 3/Fase 5) — Pendiente -> Autorizada.
 * Permiso EXACTAMENTE `gastos_operativos_autorizar:editar`, el mismo que
 * exige `rechazar/route.ts` — ambas son decisiones de aprobación, mismo
 * criterio que ya usa Viáticos (viaticos/[id]/autorizar|rechazar) para su
 * propio par de acciones.
 *
 * La identidad del autorizante viene SIEMPRE de `guard.session` — nunca
 * del body. El único campo que se lee del body es `autorizanteEmpleadoId`
 * (vínculo legado/informativo con RRHH, igual que Fondos); `estado`,
 * `autorizanteUsuarioId` y `autorizanteNombre` no están en el schema, así
 * que Zod los descarta aunque el cliente los envíe.
 *
 * GASTOS-ADMINISTRATIVO-1 (Fase 5) — exige "Mi firma" del autorizante,
 * mismo patrón EXACTO que `fondos/[id]/route.ts` (accion:"autorizar"):
 * se lee `leerBytesFirmaGuardada(guard.session.id)` ANTES de llamar a la
 * lib; si no existe, 400 con el mensaje fijo `MENSAJE_FIRMA_REQUERIDA_AUTORIZAR`
 * (propio de Gastos), sin tocar la base de datos.
 */
const schema = z.object({
  autorizanteEmpleadoId: z.number().int().positive().nullable().optional(),
});

export async function POST(req: Request, ctx: Ctx) {
  try {
    const { slug, id } = await ctx.params;
    const guard = await requireTenantGastosOperativosAutorizar(slug, "editar");
    if (guard.error) return guard.error;

    const gastoId = Number(id);
    if (!Number.isFinite(gastoId)) {
      return NextResponse.json({ error: "ID inválido." }, { status: 400 });
    }

    const parsed = schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
    }

    const firmaImagen = await leerBytesFirmaGuardada(guard.session.id);
    if (!firmaImagen) {
      return NextResponse.json({ error: MENSAJE_FIRMA_REQUERIDA_AUTORIZAR }, { status: 400 });
    }

    const gasto = await autorizarGasto(guard.empresa.id, gastoId, {
      usuario: guard.session.username,
      autorizanteUsuarioId: guard.session.id,
      autorizanteNombre: guard.session.nombre || guard.session.username,
      autorizanteRol: guard.session.rol ?? null,
      autorizanteEmpleadoId: parsed.data.autorizanteEmpleadoId,
      firmaImagen,
    });
    if (!gasto) return NextResponse.json({ error: "Gasto no encontrado." }, { status: 404 });
    return NextResponse.json({ mensaje: "Gasto autorizado.", gasto });
  } catch (error) {
    if (error instanceof ErrorGasto) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("POST autorizar gasto", error);
    return NextResponse.json({ error: "No se pudo autorizar el gasto." }, { status: 500 });
  }
}
