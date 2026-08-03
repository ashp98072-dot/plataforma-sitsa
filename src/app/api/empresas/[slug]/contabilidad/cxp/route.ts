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
    `SELECT * FROM cont_cxp WHERE empresa_id = ? ORDER BY fecha DESC LIMIT 200`,
    [guard.empresa.id],
  );
  return NextResponse.json({ cxp: rows });
}

const schema = z.object({
  proveedor: z.string().min(1),
  documento: z.string().optional(),
  fecha: z.string().min(8),
  vencimiento: z.string().optional(),
  monto: z.number().nonnegative(),
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
    `INSERT INTO cont_cxp (empresa_id, proveedor, documento, fecha, vencimiento, monto, saldo, estado)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'Pendiente')`,
    [
      guard.empresa.id,
      d.proveedor,
      d.documento ?? null,
      d.fecha,
      d.vencimiento ?? null,
      d.monto,
      d.monto,
    ],
  );
  return NextResponse.json({ id: result.insertId, mensaje: "CxP registrada." });
}
