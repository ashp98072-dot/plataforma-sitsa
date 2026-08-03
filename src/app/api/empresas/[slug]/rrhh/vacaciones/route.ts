import { NextResponse } from "next/server";
import { z } from "zod";
import type { RowDataPacket } from "mysql2";
import { registrarAuditoria } from "@/lib/auditoria";
import { execute, query } from "@/lib/db";
import { requireTenantModulo } from "@/lib/tenant";

type Ctx = { params: Promise<{ slug: string }> };

function diasHabiles(inicio: string, fin: string): number {
  const a = new Date(inicio + "T12:00:00");
  const b = new Date(fin + "T12:00:00");
  if (b < a) return 0;
  let n = 0;
  const cur = new Date(a);
  while (cur <= b) {
    if (cur.getDay() !== 0) n += 1;
    cur.setDate(cur.getDate() + 1);
  }
  return n;
}

export async function GET(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantModulo(slug, "rrhh");
  if (guard.error) return guard.error;

  const rows = await query<RowDataPacket[]>(
    `SELECT v.id, v.fecha_inicio, v.fecha_fin, v.dias_habiles, v.observaciones, v.estado,
            e.codigo AS emp_codigo, e.nombre AS emp_nombre
     FROM vacaciones v
     INNER JOIN empleados e ON e.id = v.id_empleado
     WHERE v.empresa_id = ?
     ORDER BY v.fecha_inicio DESC
     LIMIT 300`,
    [guard.empresa.id],
  );
  return NextResponse.json({ vacaciones: rows });
}

const schema = z.object({
  empleadoId: z.number().int().positive(),
  fechaInicio: z.string().min(8),
  fechaFin: z.string().min(8),
  observaciones: z.string().optional(),
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

  const dias = diasHabiles(d.fechaInicio, d.fechaFin);
  const result = await execute(
    `INSERT INTO vacaciones
      (empresa_id, id_empleado, fecha_inicio, fecha_fin, dias_habiles, observaciones, estado, creado_por)
     VALUES (?, ?, ?, ?, ?, ?, 'Aprobado', ?)`,
    [
      guard.empresa.id,
      d.empleadoId,
      d.fechaInicio,
      d.fechaFin,
      dias,
      d.observaciones ?? null,
      guard.session.username,
    ],
  );

  await registrarAuditoria({
    empresaId: guard.empresa.id,
    usuario: guard.session.username,
    accion: "crear",
    modulo: "rrhh",
    detalle: `Vacaciones #${result.insertId} emp=${d.empleadoId} ${d.fechaInicio}→${d.fechaFin}`,
  });

  return NextResponse.json({
    id: result.insertId,
    diasHabiles: dias,
    mensaje: "Vacaciones registradas.",
  });
}
