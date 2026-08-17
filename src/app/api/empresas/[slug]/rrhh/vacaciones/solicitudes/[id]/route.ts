import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantRrhh } from "@/lib/tenant";
import {
  aprobarSolicitud,
  rechazarSolicitud,
} from "@/lib/rrhh/solicitudes-vacaciones";

type Ctx = { params: Promise<{ slug: string; id: string }> };

const schema = z.object({
  accion: z.enum(["aprobar", "rechazar"]),
  comentario: z.string().optional(),
});

/**
 * PATCH /api/empresas/[slug]/rrhh/vacaciones/solicitudes/[id]
 * body: { accion: "aprobar" | "rechazar", comentario?: string }
 *
 * Aprobar descuenta el saldo real (FIFO) vía aprobarSolicitud(), que ya
 * valida que la solicitud siga Pendiente y que haya saldo suficiente en
 * este momento. Rechazar solo cambia el estado, nunca toca saldo.
 */
export async function PATCH(req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "vacaciones", "editar");
  if (guard.error) return guard.error;

  const solicitudId = Number(id);
  if (!Number.isFinite(solicitudId) || solicitudId <= 0) {
    return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  }

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }

  const resueltoPor =
    guard.session.nombre || guard.session.username || "RRHH";

  const r =
    parsed.data.accion === "aprobar"
      ? await aprobarSolicitud(
          guard.empresa.id,
          solicitudId,
          resueltoPor,
          parsed.data.comentario,
        )
      : await rechazarSolicitud(
          guard.empresa.id,
          solicitudId,
          resueltoPor,
          parsed.data.comentario,
        );

  if (!r.ok) {
    return NextResponse.json({ error: r.mensaje }, { status: 400 });
  }
  return NextResponse.json({ mensaje: r.mensaje });
}