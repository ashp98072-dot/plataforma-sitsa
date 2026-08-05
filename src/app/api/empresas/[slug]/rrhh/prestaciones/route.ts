import { NextResponse } from "next/server";
import { z } from "zod";
import type { RowDataPacket } from "mysql2";
import { execute, query } from "@/lib/db";
import { requireTenantRrhh } from "@/lib/tenant";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "prestaciones", "ver");
  if (guard.error) return guard.error;
  try {
    const rows = await query<RowDataPacket[]>(
      `SELECT p.*, e.codigo AS emp_codigo, e.nombre AS emp_nombre
       FROM rrhh_prestaciones p
       INNER JOIN empleados e ON e.id = p.id_empleado
       WHERE p.empresa_id = ?
       ORDER BY p.fecha DESC LIMIT 300`,
      [guard.empresa.id],
    );
    return NextResponse.json({ prestaciones: rows });
  } catch {
    return NextResponse.json({
      prestaciones: [],
      aviso: "Importa sql/migrate-2026-08-rrhh-ops.sql en phpMyAdmin.",
    });
  }
}

const schema = z.object({
  empleadoId: z.number().int().positive(),
  tipo: z.string().min(1),
  monto: z.number().nonnegative(),
  fecha: z.string().min(8),
  notas: z.string().optional(),
});

export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "prestaciones", "crear");
  if (guard.error) return guard.error;
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }
  const d = parsed.data;
  try {
    const r = await execute(
      `INSERT INTO rrhh_prestaciones
        (empresa_id, id_empleado, tipo, monto, fecha, notas, creado_por)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        guard.empresa.id,
        d.empleadoId,
        d.tipo,
        d.monto,
        d.fecha,
        d.notas ?? null,
        guard.session.username,
      ],
    );
    return NextResponse.json({ id: r.insertId, mensaje: "Prestación registrada." });
  } catch {
    return NextResponse.json(
      { error: "Falta migrate-2026-08-rrhh-ops.sql en la base." },
      { status: 500 },
    );
  }
}
