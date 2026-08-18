import { NextResponse } from "next/server";
import { requireTenantRrhh } from "@/lib/tenant";
import { eliminarEntradaBitacoraLegal } from "@/lib/rrhh/bitacora-legal";

type Ctx = { params: Promise<{ slug: string; id: string }> };

/**
 * DELETE /api/empresas/[slug]/rrhh/bitacora-legal/[id]
 * La bitácora legal es un registro histórico: a propósito no hay PATCH de
 * edición de contenido, solo eliminar (para corregir un error de captura).
 */
export async function DELETE(_req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "bitacora_legal", "editar");
  if (guard.error) return guard.error;

  const entradaId = Number(id);
  if (!Number.isFinite(entradaId) || entradaId <= 0) {
    return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  }

  const r = await eliminarEntradaBitacoraLegal(guard.empresa.id, entradaId);
  if (!r.ok) {
    return NextResponse.json({ error: r.mensaje }, { status: 400 });
  }
  return NextResponse.json({ mensaje: r.mensaje });
}