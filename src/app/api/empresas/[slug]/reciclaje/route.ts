import { NextResponse } from "next/server";
import { z } from "zod";
import type { RowDataPacket } from "mysql2";
import { execute, query } from "@/lib/db";
import { requireTenantModulo } from "@/lib/tenant";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantModulo(slug, "reciclaje");
  if (guard.error) return guard.error;
  const rows = await query<RowDataPacket[]>(
    `SELECT * FROM mod_reciclaje_lotes WHERE empresa_id = ? ORDER BY fecha DESC LIMIT 200`,
    [guard.empresa.id],
  );
  return NextResponse.json({ lotes: rows });
}

const schema = z.object({
  codigo: z.string().min(1),
  material: z.string().min(1),
  pesoKg: z.number().default(0),
  proveedor: z.string().optional(),
  fecha: z.string().min(1),
});

export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantModulo(slug, "reciclaje", true);
  if (guard.error) return guard.error;
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }
  const d = parsed.data;
  const result = await execute(
    `INSERT INTO mod_reciclaje_lotes (empresa_id, codigo, material, peso_kg, proveedor, fecha)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      guard.empresa.id,
      d.codigo,
      d.material,
      d.pesoKg,
      d.proveedor ?? null,
      d.fecha,
    ],
  );
  return NextResponse.json({ id: result.insertId, mensaje: "Lote registrado." });
}
