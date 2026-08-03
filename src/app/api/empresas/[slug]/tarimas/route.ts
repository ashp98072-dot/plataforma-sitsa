import { NextResponse } from "next/server";
import { z } from "zod";
import type { RowDataPacket } from "mysql2";
import { execute, query } from "@/lib/db";
import { requireTenantModulo } from "@/lib/tenant";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantModulo(slug, "tarimas");
  if (guard.error) return guard.error;
  const rows = await query<RowDataPacket[]>(
    `SELECT * FROM mod_tarimas_ordenes WHERE empresa_id = ? ORDER BY fecha DESC LIMIT 200`,
    [guard.empresa.id],
  );
  return NextResponse.json({ ordenes: rows });
}

const schema = z.object({
  codigo: z.string().min(1),
  cliente: z.string().optional(),
  cantidad: z.number().int().default(0),
  fecha: z.string().min(1),
});

export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantModulo(slug, "tarimas", true);
  if (guard.error) return guard.error;
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }
  const d = parsed.data;
  const result = await execute(
    `INSERT INTO mod_tarimas_ordenes (empresa_id, codigo, cliente, cantidad, fecha, estado)
     VALUES (?, ?, ?, ?, ?, 'Pendiente')`,
    [guard.empresa.id, d.codigo, d.cliente ?? null, d.cantidad, d.fecha],
  );
  return NextResponse.json({ id: result.insertId, mensaje: "Orden creada." });
}
