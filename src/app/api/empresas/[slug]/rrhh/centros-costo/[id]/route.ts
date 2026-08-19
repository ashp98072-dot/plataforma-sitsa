import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantRrhh } from "@/lib/tenant";
import {
  actualizarCentroCosto,
  desactivarCentroCosto,
} from "@/lib/rrhh/centros-costo";

type Ctx = { params: Promise<{ slug: string; id: string }> };

const patchSchema = z.object({
  codigo: z.string().min(1).optional(),
  nombre: z.string().min(1).optional(),
  activo: z.boolean().optional(),
});

export async function PATCH(req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "centros_costo", "editar");
  if (guard.error) return guard.error;

  const centroId = Number(id);
  if (!Number.isFinite(centroId) || centroId <= 0) {
    return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }

  const r = await actualizarCentroCosto(guard.empresa.id, centroId, parsed.data);
  if (!r.ok) {
    return NextResponse.json({ error: r.mensaje }, { status: 400 });
  }
  return NextResponse.json({ mensaje: r.mensaje });
}

export async function DELETE(req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "centros_costo", "editar");
  if (guard.error) return guard.error;

  const centroId = Number(id);
  if (!Number.isFinite(centroId) || centroId <= 0) {
    return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  }

  const r = await desactivarCentroCosto(guard.empresa.id, centroId);
  if (!r.ok) {
    return NextResponse.json({ error: r.mensaje }, { status: 400 });
  }
  return NextResponse.json({ mensaje: r.mensaje });
}