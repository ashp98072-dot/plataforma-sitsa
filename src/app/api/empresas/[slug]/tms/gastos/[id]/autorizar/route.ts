import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantGastosAutorizar } from "@/lib/tenant";
import { ErrorGasto, autorizarGasto } from "@/lib/tms/gastos";

type Ctx = { params: Promise<{ slug: string; id: string }> };

/**
 * GASTOS-ADMINISTRATIVO-1 (Fase 3) — Pendiente -> Autorizada. Permiso
 * EXACTAMENTE `gastos_autorizar:editar` (requireTenantGastosAutorizar),
 * el mismo que exige `rechazar/route.ts` — ambas son decisiones de
 * aprobación, mismo criterio que ya usa Viáticos
 * (viaticos/[id]/autorizar|rechazar) para su propio par de acciones.
 *
 * La identidad del autorizante viene SIEMPRE de `guard.session` — nunca
 * del body. El único campo que se lee del body es `autorizanteEmpleadoId`
 * (vínculo legado/informativo con RRHH, igual que Fondos); `estado`,
 * `autorizanteUsuarioId` y `autorizanteNombre` no están en el schema, así
 * que Zod los descarta aunque el cliente los envíe.
 *
 * Sin firma todavía (fuera de alcance de esta fase, ver autorizarGasto en
 * gastos.ts) — a diferencia de viaticos/[id]/autorizar, este endpoint no
 * es multipart ni exige "Mi firma".
 */
const schema = z.object({
  autorizanteEmpleadoId: z.number().int().positive().nullable().optional(),
});

export async function POST(req: Request, ctx: Ctx) {
  try {
    const { slug, id } = await ctx.params;
    const guard = await requireTenantGastosAutorizar(slug, "editar");
    if (guard.error) return guard.error;

    const gastoId = Number(id);
    if (!Number.isFinite(gastoId)) {
      return NextResponse.json({ error: "ID inválido." }, { status: 400 });
    }

    const parsed = schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
    }

    const gasto = await autorizarGasto(guard.empresa.id, gastoId, {
      usuario: guard.session.username,
      autorizanteUsuarioId: guard.session.id,
      autorizanteNombre: guard.session.nombre || guard.session.username,
      autorizanteEmpleadoId: parsed.data.autorizanteEmpleadoId,
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
