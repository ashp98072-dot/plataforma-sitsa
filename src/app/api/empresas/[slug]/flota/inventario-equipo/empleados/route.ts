import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { query } from "@/lib/db";
import { requireTenantFlota } from "@/lib/tenant";

type Ctx = { params: Promise<{ slug: string }> };

/** Empleados RRHH activos para asignar herramientas propias. */
export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantFlota(slug, "flota_inventario", "ver");
  if (guard.error) return guard.error;

  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  try {
    const params: unknown[] = [guard.empresa.id];
    let where = `empresa_id = ? AND estado = 'Activo'`;
    if (q) {
      where += ` AND (nombre LIKE ? OR codigo LIKE ? OR COALESCE(puesto,'') LIKE ?)`;
      const like = `%${q}%`;
      params.push(like, like, like);
    }
    const rows = await query<RowDataPacket[]>(
      `SELECT id, codigo, nombre, puesto, categoria_ops, estado
       FROM empleados
       WHERE ${where}
       ORDER BY nombre
       LIMIT 300`,
      params,
    );
    return NextResponse.json({
      empleados: rows.map((r) => ({
        id: Number(r.id),
        codigo: String(r.codigo),
        nombre: String(r.nombre),
        puesto: r.puesto ? String(r.puesto) : "",
        categoriaOps: r.categoria_ops ? String(r.categoria_ops) : "",
        estado: String(r.estado),
      })),
    });
  } catch {
    return NextResponse.json({ empleados: [] });
  }
}
