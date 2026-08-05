import { NextResponse } from "next/server";
import { z } from "zod";
import type { RowDataPacket } from "mysql2";
import { execute, query } from "@/lib/db";
import { requireTenantRrhh } from "@/lib/tenant";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "planillas", "ver");
  if (guard.error) return guard.error;
  try {
    const rows = await query<RowDataPacket[]>(
      `SELECT * FROM rrhh_planilla_periodos
       WHERE empresa_id = ? ORDER BY fecha_inicio DESC LIMIT 100`,
      [guard.empresa.id],
    );
    const empleados = await query<RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM empleados
       WHERE empresa_id = ? AND estado = 'Activo'`,
      [guard.empresa.id],
    );
    return NextResponse.json({
      planillas: rows,
      empleadosActivos: Number(empleados[0]?.n ?? 0),
    });
  } catch {
    return NextResponse.json({
      planillas: [],
      empleadosActivos: 0,
      aviso: "Importa sql/migrate-2026-08-rrhh-ops.sql en phpMyAdmin.",
    });
  }
}

const schema = z.object({
  codigo: z.string().min(1),
  fechaInicio: z.string().min(8),
  fechaFin: z.string().min(8),
  notas: z.string().optional(),
});

export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "planillas", "crear");
  if (guard.error) return guard.error;
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }
  const d = parsed.data;
  try {
    const r = await execute(
      `INSERT INTO rrhh_planilla_periodos
        (empresa_id, codigo, fecha_inicio, fecha_fin, estado, notas, creado_por)
       VALUES (?, ?, ?, ?, 'Borrador', ?, ?)`,
      [
        guard.empresa.id,
        d.codigo,
        d.fechaInicio,
        d.fechaFin,
        d.notas ?? null,
        guard.session.username,
      ],
    );
    return NextResponse.json({
      id: r.insertId,
      mensaje: "Periodo de planilla creado (borrador).",
    });
  } catch {
    return NextResponse.json(
      { error: "Falta migrate-2026-08-rrhh-ops.sql en la base." },
      { status: 500 },
    );
  }
}
