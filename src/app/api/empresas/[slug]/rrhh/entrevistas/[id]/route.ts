import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantRrhh } from "@/lib/tenant";
import {
  actualizarEntrevista,
  eliminarEntrevista,
  obtenerEntrevista,
} from "@/lib/rrhh/entrevistas";

type Ctx = { params: Promise<{ slug: string; id: string }> };

// RRHH-ENTREVISTAS-IDENTIDAD-1 (punto 13) — antes este schema no aceptaba nombre/teléfono/email/puesto, aunque el UI
// los mostraba editables (causa raíz reportada de "no deja editar"). Ahora sí: nombres/apellidos separados
// (primerNombre/primerApellido nunca pueden quedar vacíos si se toca la identidad — se valida en actualizarEntrevista),
// teléfono, email y puesto.
const patchSchema = z.object({
  candidatoPrimerNombre: z.string().trim().optional(),
  candidatoSegundoNombre: z.string().nullable().optional(),
  candidatoTercerNombre: z.string().nullable().optional(),
  candidatoCuartoNombre: z.string().nullable().optional(),
  candidatoPrimerApellido: z.string().trim().optional(),
  candidatoSegundoApellido: z.string().nullable().optional(),
  candidatoApellidoCasada: z.string().nullable().optional(),
  candidatoTelefono: z.string().nullable().optional(),
  candidatoEmail: z.string().email().nullable().optional().or(z.literal("")),
  puesto: z.string().optional(),
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

export async function GET(_req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "entrevistas", "ver");
  if (guard.error) return guard.error;

  const entrevistaId = Number(id);
  if (!Number.isInteger(entrevistaId) || entrevistaId <= 0) {
    return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  }
  const entrevista = await obtenerEntrevista(guard.empresa.id, entrevistaId);
  if (!entrevista) {
    return NextResponse.json({ error: "Entrevista no encontrada." }, { status: 404 });
  }
  return NextResponse.json({ entrevista });
}

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
