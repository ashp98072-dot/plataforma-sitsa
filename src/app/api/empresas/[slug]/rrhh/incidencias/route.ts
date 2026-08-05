import { NextResponse } from "next/server";
import { z } from "zod";
import type { RowDataPacket } from "mysql2";
import { registrarAuditoria } from "@/lib/auditoria";
import { execute, query } from "@/lib/db";
import { requireTenantRrhh } from "@/lib/tenant";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "incidencias", "ver");
  if (guard.error) return guard.error;

  const rows = await query<RowDataPacket[]>(
    `SELECT i.id, i.tipo, i.fecha_inicio, i.fecha_fin, i.dias_habiles,
            e.codigo AS emp_codigo, e.nombre AS emp_nombre
     FROM incidencias i
     INNER JOIN empleados e ON e.id = i.id_empleado
     WHERE i.empresa_id = ?
     ORDER BY i.fecha_inicio DESC
     LIMIT 300`,
    [guard.empresa.id],
  );
  return NextResponse.json({ incidencias: rows });
}

const schema = z.object({
  empleadoId: z.number().int().positive(),
  tipo: z.string().min(1),
  fechaInicio: z.string().min(8),
  fechaFin: z.string().min(8),
  diasHabiles: z.number().nonnegative().default(1),
});

export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "incidencias", "crear");
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

  const result = await execute(
    `INSERT INTO incidencias (empresa_id, id_empleado, tipo, fecha_inicio, fecha_fin, dias_habiles)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      guard.empresa.id,
      d.empleadoId,
      d.tipo,
      d.fechaInicio,
      d.fechaFin,
      d.diasHabiles,
    ],
  );

  await registrarAuditoria({
    empresaId: guard.empresa.id,
    usuario: guard.session.username,
    accion: "crear",
    modulo: "rrhh",
    detalle: `Incidencia #${result.insertId} ${d.tipo}`,
  });

  return NextResponse.json({ id: result.insertId, mensaje: "Incidencia registrada." });
}
