import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantRrhh } from "@/lib/tenant";
import {
  ReparacionBloqueadaError, ReparacionCambioError, ReparacionEmpleadoNoEncontradoError, repararSerieVacaciones,
} from "@/lib/rrhh/vacaciones-reparacion-db";

type Ctx = { params: Promise<{ slug: string; id: string }> };

// Solo la huella de la vista previa confirmada. La empresa, el colaborador, la fecha de alta y el usuario salen SIEMPRE del servidor.
const schema = z.object({ huella: z.string().regex(/^[0-9a-f]{32}$/) });

/**
 * REPARACIÓN ADMINISTRADA de la serie de vacaciones de UN colaborador (nunca masiva, nunca automática). Vuelve a validar TODO dentro de una
 * transacción (no confía en la vista previa), exige que lo confirmado sea lo previsualizado y reemplaza solo los saldos y el detalle FIFO de ese
 * colaborador usando su `fecha_alta` actual. No modifica la fecha de alta, las vacaciones registradas ni sus evidencias. Permiso: RRHH · Vacaciones · editar.
 */
export async function POST(req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "vacaciones", "editar");
  if (guard.error) return guard.error;
  const empId = Number(id);
  if (!/^\d+$/.test(id) || !Number.isSafeInteger(empId) || empId <= 0) return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Falta la confirmación de la vista previa (huella)." }, { status: 400 });
  try {
    const r = await repararSerieVacaciones(guard.empresa.id, empId, { huella: parsed.data.huella, usuario: guard.session.username });
    if (!r.aplicado) {
      return NextResponse.json({ aplicado: false, requiereReparacion: false, mensaje: "La serie de este colaborador ya coincide con su fecha de contratación: no se modificó nada." }, { headers: { "Cache-Control": "private, no-store" } });
    }
    return NextResponse.json(
      { aplicado: true, periodos: r.plan.periodos.length, consumidoPreservado: r.plan.consumidoPreservado, saldoAntes: r.plan.saldoAntes, saldoDespues: r.plan.saldoDespues },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    if (error instanceof ReparacionEmpleadoNoEncontradoError) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
    if (error instanceof ReparacionBloqueadaError) {
      return NextResponse.json({ codigo: "REPARACION_BLOQUEADA", error: error.message, bloqueos: error.plan.bloqueos }, { status: 409 });
    }
    if (error instanceof ReparacionCambioError) return NextResponse.json({ codigo: "CAMBIO_DESDE_PREVIEW", error: error.message }, { status: 409 });
    console.error("[empleados/vacaciones/reparacion]", error);
    return NextResponse.json({ error: "No se pudo reparar la serie de vacaciones. No se modificó nada." }, { status: 500 });
  }
}
