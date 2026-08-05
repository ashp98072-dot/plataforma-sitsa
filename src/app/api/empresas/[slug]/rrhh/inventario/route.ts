import { NextResponse } from "next/server";
import { z } from "zod";
import type { RowDataPacket } from "mysql2";
import { execute, query } from "@/lib/db";
import { requireTenantRrhh } from "@/lib/tenant";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "inventario", "ver");
  if (guard.error) return guard.error;
  const rows = await query<RowDataPacket[]>(
    `SELECT id, codigo, nombre, categoria, stock, unidad, estado
     FROM inventario_rrhh WHERE empresa_id = ? ORDER BY nombre`,
    [guard.empresa.id],
  );
  return NextResponse.json({ items: rows });
}

const schema = z.object({
  codigo: z.string().min(1),
  nombre: z.string().min(1),
  categoria: z.string().optional(),
  stock: z.number().int().default(0),
  unidad: z.string().default("Unidad"),
});

export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "inventario", "crear");
  if (guard.error) return guard.error;
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }
  const d = parsed.data;
  const result = await execute(
    `INSERT INTO inventario_rrhh (empresa_id, codigo, nombre, categoria, stock, unidad)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      guard.empresa.id,
      d.codigo,
      d.nombre,
      d.categoria ?? null,
      d.stock,
      d.unidad,
    ],
  );
  return NextResponse.json({ id: result.insertId, mensaje: "Item registrado." });
}
