import { NextResponse } from "next/server";
import { z } from "zod";
import type { RowDataPacket } from "mysql2";
import { execute, query } from "@/lib/db";
import { requireTenantModulo } from "@/lib/tenant";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantModulo(slug, "rrhh");
  if (guard.error) return guard.error;

  const rows = await query<RowDataPacket[]>(
    `SELECT id, codigo, nombre, puesto, tipo_horario, estado, hora_entrada_teorica, hora_salida_teorica
     FROM empleados WHERE empresa_id = ? ORDER BY nombre`,
    [guard.empresa.id],
  );
  return NextResponse.json({
    empleados: rows.map((r) => ({
      id: Number(r.id),
      codigo: String(r.codigo),
      nombre: String(r.nombre),
      puesto: r.puesto ? String(r.puesto) : "",
      tipoHorario: String(r.tipo_horario),
      estado: String(r.estado),
      horaEntrada: String(r.hora_entrada_teorica ?? "08:00:00"),
      horaSalida: String(r.hora_salida_teorica ?? "17:00:00"),
    })),
  });
}

const bodySchema = z.object({
  codigo: z.string().min(1),
  nombre: z.string().min(1),
  puesto: z.string().optional(),
  tipoHorario: z.enum(["Fijo", "Variable"]).default("Fijo"),
  estado: z.enum(["Activo", "Baja"]).default("Activo"),
});

export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantModulo(slug, "rrhh", true);
  if (guard.error) return guard.error;

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }
  const d = parsed.data;
  const result = await execute(
    `INSERT INTO empleados (empresa_id, codigo, nombre, puesto, tipo_horario, fecha_alta, estado)
     VALUES (?, ?, ?, ?, ?, CURDATE(), ?)`,
    [guard.empresa.id, d.codigo, d.nombre, d.puesto ?? "", d.tipoHorario, d.estado],
  );
  return NextResponse.json({ id: result.insertId, mensaje: "Empleado creado." });
}
