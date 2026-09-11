import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantGastosOperativosAutorizar } from "@/lib/tenant";
import { ErrorGasto, rechazarGasto } from "@/lib/tms/gastos";

type Ctx = { params: Promise<{ slug: string; id: string }> };

/**
 * GASTOS-ADMINISTRATIVO-1 (Fase 3) — Pendiente -> Rechazada. Mismo
 * permiso EXACTO que autorizar (`gastos_operativos_autorizar:editar`, ver
 * autorizar/route.ts) — ambas son decisiones de aprobación.
 *
 * Body JSON simple `{ motivoRechazo: string }` — sin multipart, sin
 * firma (fuera de alcance de esta fase). `rechazarGasto` no valida
 * autoautorización (mismo criterio que cambiarEstadoSolicitudFondo en
 * Fondos: rechazar no es un conflicto de interés en el mismo sentido que
 * autorizar).
 */
const schema = z.object({
  motivoRechazo: z.string().min(1).max(300),
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
      return NextResponse.json({ error: "El rechazo requiere un motivo." }, { status: 400 });
    }

    const gasto = await rechazarGasto(guard.empresa.id, gastoId, {
      usuario: guard.session.username,
      motivoRechazo: parsed.data.motivoRechazo,
    });
    if (!gasto) return NextResponse.json({ error: "Gasto no encontrado." }, { status: 404 });
    return NextResponse.json({ mensaje: "Gasto rechazado.", gasto });
  } catch (error) {
    if (error instanceof ErrorGasto) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("POST rechazar gasto", error);
    return NextResponse.json({ error: "No se pudo rechazar el gasto." }, { status: 500 });
  }
}
