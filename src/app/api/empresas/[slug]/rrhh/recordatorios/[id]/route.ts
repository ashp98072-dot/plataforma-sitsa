import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantRrhh } from "@/lib/tenant";
import {
  actualizarRecordatorio,
  eliminarRecordatorio,
  marcarRecordatorioAtendido,
} from "@/lib/rrhh/recordatorios";

type Ctx = { params: Promise<{ slug: string; id: string }> };

const patchSchema = z.object({
  // Si viene `accion: "marcarAtendido"`, se ignoran los demás campos y solo
  // se marca atendida la ocurrencia vigente (ver lógica en recordatorios.ts
  // para el comportamiento con recurrentes).
  accion: z.literal("marcarAtendido").optional(),
  titulo: z.string().min(1).optional(),
  fecha: z.string().optional(),
  recurrente: z.boolean().optional(),
  diasAvisoPrevio: z.number().int().min(0).max(365).optional(),
  empleadoId: z.number().int().positive().nullable().optional(),
  notas: z.string().nullable().optional(),
});

function parseId(id: string): number | null {
  const n = Number(id);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * PATCH /api/empresas/[slug]/rrhh/recordatorios/[id]
 * Edita campos del recordatorio, o marca la ocurrencia vigente como
 * atendida con { "accion": "marcarAtendido" }.
 */
export async function PATCH(req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "recordatorios", "editar");
  if (guard.error) return guard.error;

  const recordatorioId = parseId(id);
  if (!recordatorioId) {
    return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }

  const r =
    parsed.data.accion === "marcarAtendido"
      ? await marcarRecordatorioAtendido(guard.empresa.id, recordatorioId)
      : await actualizarRecordatorio(guard.empresa.id, recordatorioId, parsed.data);

  if (!r.ok) {
    return NextResponse.json({ error: r.mensaje }, { status: 400 });
  }
  return NextResponse.json({ mensaje: r.mensaje });
}

/**
 * DELETE /api/empresas/[slug]/rrhh/recordatorios/[id]
 */
export async function DELETE(_req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "recordatorios", "editar");
  if (guard.error) return guard.error;

  const recordatorioId = parseId(id);
  if (!recordatorioId) {
    return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  }

  const r = await eliminarRecordatorio(guard.empresa.id, recordatorioId);
  if (!r.ok) {
    return NextResponse.json({ error: r.mensaje }, { status: 400 });
  }
  return NextResponse.json({ mensaje: r.mensaje });
}