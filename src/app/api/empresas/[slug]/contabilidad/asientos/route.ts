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
    `SELECT id, fecha, numero, glosa, estado, creado_por
     FROM cont_asientos WHERE empresa_id = ? ORDER BY fecha DESC, id DESC LIMIT 100`,
    [guard.empresa.id],
  );
  return NextResponse.json({ asientos: rows });
}

const schema = z.object({
  numero: z.string().min(1),
  fecha: z.string().min(1),
  glosa: z.string().optional(),
  lineas: z
    .array(
      z.object({
        cuentaId: z.number(),
        debe: z.number().default(0),
        haber: z.number().default(0),
      }),
    )
    .min(2),
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
  const totalDebe = d.lineas.reduce((s, l) => s + l.debe, 0);
  const totalHaber = d.lineas.reduce((s, l) => s + l.haber, 0);
  if (Math.abs(totalDebe - totalHaber) > 0.001) {
    return NextResponse.json(
      { error: "El asiento no cuadra (debe ≠ haber)." },
      { status: 400 },
    );
  }
  const asiento = await execute(
    `INSERT INTO cont_asientos (empresa_id, fecha, numero, glosa, estado, creado_por)
     VALUES (?, ?, ?, ?, 'Registrado', ?)`,
    [
      guard.empresa.id,
      d.fecha,
      d.numero,
      d.glosa ?? null,
      guard.session.username,
    ],
  );
  const asientoId = Number(asiento.insertId);
  for (const l of d.lineas) {
    await execute(
      `INSERT INTO cont_asiento_detalle (asiento_id, cuenta_id, debe, haber)
       VALUES (?, ?, ?, ?)`,
      [asientoId, l.cuentaId, l.debe, l.haber],
    );
  }
  return NextResponse.json({ id: asientoId, mensaje: "Asiento registrado." });
}
