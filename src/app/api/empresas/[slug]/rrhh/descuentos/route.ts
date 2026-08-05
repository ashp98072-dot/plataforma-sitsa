import { NextResponse } from "next/server";
import { z } from "zod";
import type { RowDataPacket } from "mysql2";
import { execute, query } from "@/lib/db";
import { requireTenantRrhh } from "@/lib/tenant";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "descuentos", "ver");
  if (guard.error) return guard.error;
  try {
    const rows = await query<RowDataPacket[]>(
      `SELECT d.*, e.codigo AS emp_codigo, e.nombre AS emp_nombre
       FROM rrhh_descuentos d
       INNER JOIN empleados e ON e.id = d.id_empleado
       WHERE d.empresa_id = ?
       ORDER BY d.fecha DESC LIMIT 300`,
      [guard.empresa.id],
    );
    return NextResponse.json({ descuentos: rows });
  } catch {
    return NextResponse.json({
      descuentos: [],
      aviso: "Importa sql/migrate-2026-08-rrhh-ops.sql en phpMyAdmin.",
    });
  }
}

const schema = z.object({
  empleadoId: z.number().int().positive(),
  concepto: z.string().min(1),
  monto: z.number().nonnegative(),
  fecha: z.string().min(8),
  notas: z.string().optional(),
});

export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "descuentos", "crear");
  if (guard.error) return guard.error;
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }
  const d = parsed.data;
  try {
    const r = await execute(
      `INSERT INTO rrhh_descuentos
        (empresa_id, id_empleado, concepto, monto, fecha, notas, creado_por)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        guard.empresa.id,
        d.empleadoId,
        d.concepto,
        d.monto,
        d.fecha,
        d.notas ?? null,
        guard.session.username,
      ],
    );
    return NextResponse.json({ id: r.insertId, mensaje: "Descuento registrado." });
  } catch {
    return NextResponse.json(
      { error: "Falta migrate-2026-08-rrhh-ops.sql en la base." },
      { status: 500 },
    );
  }
}
