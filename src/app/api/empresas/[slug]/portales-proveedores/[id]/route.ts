import { NextResponse } from "next/server";
import { execute } from "@/lib/db";
import { puedeUsarPortalesProveedores } from "@/lib/proveedores/acceso";
import { requireTenant } from "@/lib/tenant";

type Ctx = { params: Promise<{ slug: string; id: string }> };

export async function DELETE(_req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireTenant(slug);
  if (guard.error) return guard.error;
  if (!puedeUsarPortalesProveedores(guard.session.rol)) {
    return NextResponse.json({ error: "Sin acceso a portales de proveedores." }, { status: 403 });
  }
  const portalId = Number(id);
  if (!Number.isInteger(portalId) || portalId <= 0) {
    return NextResponse.json({ error: "Portal inválido." }, { status: 400 });
  }
  const admin = guard.session.rol === "Admin";
  const result = await execute(
    `DELETE FROM proveedor_portales
     WHERE id = ? AND empresa_id = ?${admin ? "" : " AND asignado_usuario_id = ?"}`,
    admin
      ? [portalId, guard.empresa.id]
      : [portalId, guard.empresa.id, guard.session.id],
  );
  if (!result.affectedRows) {
    return NextResponse.json({ error: "Portal no encontrado." }, { status: 404 });
  }
  return NextResponse.json({ mensaje: "Portal eliminado." });
}
