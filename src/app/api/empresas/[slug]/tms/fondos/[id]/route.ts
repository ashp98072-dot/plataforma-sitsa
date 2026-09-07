import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantGastos } from "@/lib/tenant";
import { cambiarEstadoSolicitudFondo, obtenerSolicitudFondo } from "@/lib/tms/fondos";

type Ctx = { params: Promise<{ slug: string; id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireTenantGastos(slug, "ver");
  if (guard.error) return guard.error;
  const solicitud = await obtenerSolicitudFondo(guard.empresa.id, Number(id));
  if (!solicitud) return NextResponse.json({ error: "Solicitud no encontrada." }, { status: 404 });
  return NextResponse.json({ solicitud });
}

const schema = z.object({
  accion: z.enum(["autorizar", "rechazar", "liquidar"]),
  autorizanteEmpleadoId: z.number().int().positive().nullable().optional(),
  autorizanteNombre: z.string().max(200).nullable().optional(),
  motivoRechazo: z.string().max(300).nullable().optional(),
});

/** Autorizar/rechazar/liquidar — nunca edita las líneas ya creadas (fase 1: la solicitud es inmutable una vez creada, solo cambia de estado). */
export async function PATCH(req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }
  // Autorizar/rechazar es una decisión administrativa — exige "editar",
  // igual que cualquier otra escritura de este módulo.
  const guard = await requireTenantGastos(slug, "editar");
  if (guard.error) return guard.error;

  try {
    const solicitud = await cambiarEstadoSolicitudFondo(guard.empresa.id, Number(id), parsed.data.accion, {
      usuario: guard.session.username,
      autorizanteEmpleadoId: parsed.data.autorizanteEmpleadoId,
      autorizanteNombre: parsed.data.autorizanteNombre ?? guard.session.username,
      motivoRechazo: parsed.data.motivoRechazo,
    });
    if (!solicitud) return NextResponse.json({ error: "Solicitud no encontrada." }, { status: 404 });
    return NextResponse.json({ mensaje: "Solicitud actualizada.", solicitud });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo actualizar la solicitud." }, { status: 400 });
  }
}
