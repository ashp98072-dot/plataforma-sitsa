import { NextResponse } from "next/server";
import { z } from "zod";
import { getColaboradorSession } from "@/lib/rrhh/colaborador-session";
import {
  aprobarHorasExtraSupervisor,
  rechazarHorasExtraSupervisor,
} from "@/lib/rrhh/horas-extra";

type Ctx = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  accion: z.enum(["aprobar", "rechazar"]),
  motivo: z.string().optional(),
});

/**
 * Fase H4 — aprobación/rechazo desde el Portal del supervisor. Complementa
 * (no reemplaza) la aprobación de RRHH en
 * /api/empresas/[slug]/rrhh/horas-extra/[id]. empresaId/supervisorId
 * SIEMPRE salen de la sesión del colaborador, nunca del body — así nadie
 * puede aprobar a nombre de otro supervisor cambiando un id. La
 * subordinación real (empleado_supervisores) se verifica server-side dentro
 * de aprobarHorasExtraSupervisor()/rechazarHorasExtraSupervisor(), no aquí
 * ni en la UI.
 */
export async function PATCH(req: Request, ctx: Ctx) {
  const session = await getColaboradorSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  }

  const { id } = await ctx.params;
  const registroId = Number(id);
  if (!Number.isFinite(registroId)) {
    return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Acción inválida." }, { status: 400 });
  }
  const d = parsed.data;
  const nombre = session.nombre || "Supervisor";

  const r =
    d.accion === "aprobar"
      ? await aprobarHorasExtraSupervisor(session.empresaId, registroId, session.empleadoId, nombre)
      : await rechazarHorasExtraSupervisor(
          session.empresaId,
          registroId,
          session.empleadoId,
          nombre,
          d.motivo ?? "",
        );

  if (!r.ok) {
    const status =
      r.motivo === "no_encontrado"
        ? 404
        : r.motivo === "no_autorizado"
          ? 403
          : r.motivo === "motivo_requerido"
            ? 400
            : 409;
    return NextResponse.json({ error: r.mensaje }, { status });
  }
  return NextResponse.json({
    mensaje: d.accion === "aprobar" ? "Registro aprobado." : "Registro rechazado.",
  });
}
