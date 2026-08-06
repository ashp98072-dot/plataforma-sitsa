import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { query } from "@/lib/db";
import { requireTenantModulo } from "@/lib/tenant";

type Ctx = { params: Promise<{ slug: string }> };

/** Empleados operativos desde RRHH para TMS (pilotos / auxiliares). */
export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  let guard = await requireTenantModulo(slug, "tms");
  if (guard.error) guard = await requireTenantModulo(slug, "rrhh");
  if (guard.error) return guard.error;

  const tipo = (new URL(req.url).searchParams.get("tipo") ?? "all").trim();

  try {
    let rows: RowDataPacket[];
    if (tipo === "Piloto" || tipo === "Auxiliar") {
      const like =
        tipo === "Auxiliar" ? "%auxiliar%" : "%piloto%";
      rows = await query<RowDataPacket[]>(
        `SELECT id, codigo, nombre, puesto, categoria_ops, estado
         FROM empleados
         WHERE empresa_id = ? AND estado = 'Activo'
           AND (
             categoria_ops = ?
             OR LOWER(COALESCE(puesto, '')) LIKE ?
             OR LOWER(COALESCE(categoria_ops, '')) LIKE ?
           )
         ORDER BY nombre`,
        [guard.empresa.id, tipo, like, like],
      );
      if (rows.length === 0) {
        rows = await query<RowDataPacket[]>(
          `SELECT id, codigo, nombre, puesto, categoria_ops, estado
           FROM empleados
           WHERE empresa_id = ? AND estado = 'Activo'
           ORDER BY nombre`,
          [guard.empresa.id],
        );
      }
    } else {
      rows = await query<RowDataPacket[]>(
        `SELECT id, codigo, nombre, puesto, categoria_ops, estado
         FROM empleados
         WHERE empresa_id = ? AND estado = 'Activo'
         ORDER BY nombre`,
        [guard.empresa.id],
      );
    }

    return NextResponse.json({
      personal: rows.map((r) => ({
        id: Number(r.id),
        codigo: String(r.codigo),
        nombre: String(r.nombre),
        puesto: r.puesto ? String(r.puesto) : "",
        categoriaOps: r.categoria_ops ? String(r.categoria_ops) : "",
        estado: String(r.estado),
      })),
    });
  } catch {
    // Sin migrate: listar por puesto o todos los activos
    const rows = await query<RowDataPacket[]>(
      `SELECT id, codigo, nombre, puesto, estado
       FROM empleados
       WHERE empresa_id = ? AND estado = 'Activo'
       ORDER BY nombre`,
      [guard.empresa.id],
    );
    return NextResponse.json({
      personal: rows.map((r) => ({
        id: Number(r.id),
        codigo: String(r.codigo),
        nombre: String(r.nombre),
        puesto: r.puesto ? String(r.puesto) : "",
        categoriaOps: "",
        estado: String(r.estado),
      })),
      aviso: "Importa sql/migrate-2026-08-rrhh-ops.sql para categoría operativa.",
    });
  }
}
