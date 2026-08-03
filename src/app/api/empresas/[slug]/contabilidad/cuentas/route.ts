import { NextResponse } from "next/server";
import { z } from "zod";
import type { RowDataPacket } from "mysql2";
import { execute, query } from "@/lib/db";
import { requireTenantModulo } from "@/lib/tenant";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantModulo(slug, "contabilidad");
  if (guard.error) return guard.error;
  const rows = await query<RowDataPacket[]>(
    `SELECT id, codigo, nombre, tipo, nivel, activa FROM cont_cuentas
     WHERE empresa_id = ? ORDER BY codigo`,
    [guard.empresa.id],
  );
  return NextResponse.json({ cuentas: rows });
}

const schema = z.object({
  codigo: z.string().min(1),
  nombre: z.string().min(1),
  tipo: z.enum(["Activo", "Pasivo", "Capital", "Ingreso", "Gasto"]),
  nivel: z.number().int().default(1),
});

export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantModulo(slug, "contabilidad", true);
  if (guard.error) return guard.error;
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }
  const d = parsed.data;
  const result = await execute(
    `INSERT INTO cont_cuentas (empresa_id, codigo, nombre, tipo, nivel)
     VALUES (?, ?, ?, ?, ?)`,
    [guard.empresa.id, d.codigo, d.nombre, d.tipo, d.nivel],
  );
  return NextResponse.json({ id: result.insertId, mensaje: "Cuenta creada." });
}
