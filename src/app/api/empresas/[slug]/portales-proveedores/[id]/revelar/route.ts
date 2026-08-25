import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { query } from "@/lib/db";
import { descifrarCredencial } from "@/lib/proveedores/credenciales";
import { puedeUsarPortalesProveedores } from "@/lib/proveedores/acceso";
import { requireTenant } from "@/lib/tenant";

type Ctx = { params: Promise<{ slug: string; id: string }> };

export async function POST(_req: Request, ctx: Ctx) {
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
  const rows = await query<RowDataPacket[]>(
    `SELECT password_cifrado
     FROM proveedor_portales
     WHERE id = ? AND empresa_id = ?${admin ? "" : " AND asignado_usuario_id = ? AND activo = 1"}
     LIMIT 1`,
    admin
      ? [portalId, guard.empresa.id]
      : [portalId, guard.empresa.id, guard.session.id],
  );
  if (!rows[0]) {
    return NextResponse.json({ error: "Portal no encontrado o no asignado." }, { status: 404 });
  }

  try {
    return NextResponse.json(
      { password: descifrarCredencial(String(rows[0].password_cifrado)) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    console.error("[portales-proveedores] No se pudo descifrar la credencial:", error);
    return NextResponse.json({ error: "No se pudo leer la credencial." }, { status: 500 });
  }
}
