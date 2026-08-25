import { NextResponse } from "next/server";
import { execute } from "@/lib/db";
import { requireTenant } from "@/lib/tenant";

type Ctx = { params: Promise<{ slug: string; id: string }> };

export async function DELETE(_req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireTenant(slug);
  if (guard.error) return guard.error;
  if (guard.session.rol !== "Admin") {
    return NextResponse.json({ error: "Solo Admin puede eliminar portales." }, { status: 403 });
  }
  const portalId = Number(id);
  if (!Number.isInteger(portalId) || portalId <= 0) {
    return NextResponse.json({ error: "Portal inválido." }, { status: 400 });
  }
  const result = await execute(
    "DELETE FROM proveedor_portales WHERE id = ? AND empresa_id = ?",
    [portalId, guard.empresa.id],
  );
  if (!result.affectedRows) {
    return NextResponse.json({ error: "Portal no encontrado." }, { status: 404 });
  }
  return NextResponse.json({ mensaje: "Portal eliminado." });
}
