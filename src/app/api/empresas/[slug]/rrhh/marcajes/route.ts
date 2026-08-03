import { NextResponse } from "next/server";
import { z } from "zod";
import type { RowDataPacket } from "mysql2";
import { execute, query } from "@/lib/db";
import { requireTenantModulo } from "@/lib/tenant";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantModulo(slug, "rrhh");
  if (guard.error) return guard.error;

  const url = new URL(req.url);
  const desde = url.searchParams.get("desde") ?? new Date().toISOString().slice(0, 10);
  const hasta = url.searchParams.get("hasta") ?? desde;

  const rows = await query<RowDataPacket[]>(
    `SELECT s.id, s.fecha_jornada, s.entrada_at, s.salida_at, s.estado, s.comentarios_rrhh,
            e.codigo AS emp_codigo, e.nombre AS emp_nombre
     FROM sesiones_trabajo s
     INNER JOIN empleados e ON e.id = s.id_empleado
     WHERE s.empresa_id = ? AND s.fecha_jornada BETWEEN ? AND ?
     ORDER BY s.fecha_jornada DESC, e.nombre
     LIMIT 500`,
    [guard.empresa.id, desde, hasta],
  );
  return NextResponse.json({ marcajes: rows });
}

const schema = z.object({
  empleadoId: z.number().int().positive(),
  fechaJornada: z.string().min(8),
  tipo: z.enum(["entrada", "salida"]),
  comentarios: z.string().optional(),
});

export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantModulo(slug, "rrhh", true);
  if (guard.error) return guard.error;

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }
  const d = parsed.data;

  const emp = await query<RowDataPacket[]>(
    "SELECT id FROM empleados WHERE id = ? AND empresa_id = ? LIMIT 1",
    [d.empleadoId, guard.empresa.id],
  );
  if (!emp[0]) {
    return NextResponse.json({ error: "Empleado no encontrado." }, { status: 404 });
  }

  const existing = await query<RowDataPacket[]>(
    `SELECT id, entrada_at, salida_at FROM sesiones_trabajo
     WHERE empresa_id = ? AND id_empleado = ? AND fecha_jornada = ? LIMIT 1`,
    [guard.empresa.id, d.empleadoId, d.fechaJornada],
  );

  const now = new Date();
  const ts = now.toISOString().slice(0, 19).replace("T", " ");

  if (!existing[0]) {
    if (d.tipo === "salida") {
      return NextResponse.json(
        { error: "No hay entrada registrada para esa fecha." },
        { status: 400 },
      );
    }
    const result = await execute(
      `INSERT INTO sesiones_trabajo
        (empresa_id, id_empleado, fecha_jornada, entrada_at, estado, comentarios_rrhh)
       VALUES (?, ?, ?, ?, 'En curso', ?)`,
      [guard.empresa.id, d.empleadoId, d.fechaJornada, ts, d.comentarios ?? null],
    );
    return NextResponse.json({ id: result.insertId, mensaje: "Entrada registrada." });
  }

  if (d.tipo === "entrada") {
    await execute(
      `UPDATE sesiones_trabajo SET entrada_at = ?, estado = 'En curso', comentarios_rrhh = COALESCE(?, comentarios_rrhh)
       WHERE id = ? AND empresa_id = ?`,
      [ts, d.comentarios ?? null, existing[0].id, guard.empresa.id],
    );
    return NextResponse.json({ id: existing[0].id, mensaje: "Entrada actualizada." });
  }

  await execute(
    `UPDATE sesiones_trabajo SET salida_at = ?, estado = 'Cerrada', comentarios_rrhh = COALESCE(?, comentarios_rrhh)
     WHERE id = ? AND empresa_id = ?`,
    [ts, d.comentarios ?? null, existing[0].id, guard.empresa.id],
  );
  return NextResponse.json({ id: existing[0].id, mensaje: "Salida registrada." });
}
