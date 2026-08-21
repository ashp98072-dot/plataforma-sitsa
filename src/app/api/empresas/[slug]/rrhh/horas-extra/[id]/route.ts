import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantRrhh } from "@/lib/tenant";
import { aprobarHorasExtra, rechazarHorasExtra } from "@/lib/rrhh/horas-extra";

type Ctx = { params: Promise<{ slug: string; id: string }> };

const patchSchema = z.object({
  accion: z.enum(["aprobar", "rechazar"]),
  motivo: z.string().optional(),
});

/** Fase H1: aprobar/rechazar — exclusivo RRHH, nunca desde el Portal del supervisor. */
export async function PATCH(req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "horas_extra", "editar");
  if (guard.error) return guard.error;
  const registroId = Number(id);
  if (!Number.isFinite(registroId)) {
    return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Acción inválida." }, { status: 400 });
  }
  const d = parsed.data;
  const usuario = guard.session.username;

  const r =
    d.accion === "aprobar"
      ? await aprobarHorasExtra(guard.empresa.id, registroId, usuario)
      : await rechazarHorasExtra(guard.empresa.id, registroId, usuario, d.motivo ?? "");

  if (!r.ok) {
    const status =
      r.motivo === "no_encontrado" ? 404 : r.motivo === "motivo_requerido" ? 400 : 409;
    return NextResponse.json({ error: r.mensaje }, { status });
  }
  return NextResponse.json({
    mensaje: d.accion === "aprobar" ? "Registro aprobado." : "Registro rechazado.",
  });
}
