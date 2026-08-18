import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantRrhh } from "@/lib/tenant";
import { actualizarEntrevista, eliminarEntrevista } from "@/lib/rrhh/entrevistas";

type Ctx = { params: Promise<{ slug: string; id: string }> };

const patchSchema = z.object({
  fechaHora: z.string().optional(),
  entrevistadorEmpleadoId: z.number().int().positive().nullable().optional(),
  modalidad: z.enum(["Presencial", "Virtual"]).optional(),
  lugarOEnlace: z.string().nullable().optional(),
  estado: z
    .enum(["Programada", "Realizada", "Cancelada", "No asistió"])
    .optional(),
  resultado: z.enum(["Pendiente", "Aprobado", "Rechazado"]).optional(),
  notas: z.string().nullable().optional(),
});

/**
 * PATCH /api/empresas/[slug]/rrhh/entrevistas/[id]
 * Reprogramar, reasignar entrevistador, cancelar, o marcar estado/resultado.
 */
export async function PATCH(req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "entrevistas", "editar");
  if (guard.error) return guard.error;

  const entrevistaId = Number(id);
  if (!Number.isFinite(entrevistaId) || entrevistaId <= 0) {
    return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }

  const r = await actualizarEntrevista(guard.empresa.id, entrevistaId, parsed.data);
  if (!r.ok) {
    return NextResponse.json({ error: r.mensaje }, { status: 400 });
  }
  return NextResponse.json({ mensaje: r.mensaje });
}

/**
 * DELETE /api/empresas/[slug]/rrhh/entrevistas/[id]
 */
export async function DELETE(req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "entrevistas", "editar");
  if (guard.error) return guard.error;

  const entrevistaId = Number(id);
  if (!Number.isFinite(entrevistaId) || entrevistaId <= 0) {
    return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  }

  const r = await eliminarEntrevista(guard.empresa.id, entrevistaId);
  if (!r.ok) {
    return NextResponse.json({ error: r.mensaje }, { status: 400 });
  }
  return NextResponse.json({ mensaje: r.mensaje });
}