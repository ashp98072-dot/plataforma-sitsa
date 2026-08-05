import { NextResponse } from "next/server";
import { z } from "zod";
import type { RowDataPacket } from "mysql2";
import { execute, query } from "@/lib/db";
import { requireTenantRrhh } from "@/lib/tenant";

type Ctx = { params: Promise<{ slug: string }> };

/**
 * Obtiene o crea una incidencia del día para poder adjuntar evidencias
 * (faltas, retrasos, permisos, etc.).
 */
export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  let guard = await requireTenantRrhh(slug, "incidencias", "crear");
  if (guard.error) {
    guard = await requireTenantRrhh(slug, "incidencias", "editar");
  }
  if (guard.error) return guard.error;

  const schema = z.object({
    empleadoId: z.number().int().positive(),
    fecha: z.string().min(8),
    tipo: z.string().min(1).default("Falta"),
  });
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }
  const { empleadoId, fecha, tipo } = parsed.data;

  const emp = await query<RowDataPacket[]>(
    "SELECT id FROM empleados WHERE id = ? AND empresa_id = ? LIMIT 1",
    [empleadoId, guard.empresa.id],
  );
  if (!emp[0]) {
    return NextResponse.json({ error: "Empleado no encontrado." }, { status: 404 });
  }

  const existentes = await query<RowDataPacket[]>(
    `SELECT id, tipo FROM incidencias
     WHERE empresa_id = ? AND id_empleado = ?
       AND ? BETWEEN fecha_inicio AND fecha_fin
     ORDER BY id DESC LIMIT 1`,
    [guard.empresa.id, empleadoId, fecha],
  );
  if (existentes[0]) {
    return NextResponse.json({
      incidenciaId: Number(existentes[0].id),
      tipo: String(existentes[0].tipo),
      creado: false,
    });
  }

  try {
    const result = await execute(
      `INSERT INTO incidencias
        (empresa_id, id_empleado, tipo, fecha_inicio, fecha_fin, dias_habiles)
       VALUES (?, ?, ?, ?, ?, 1)`,
      [guard.empresa.id, empleadoId, tipo, fecha, fecha],
    );
    return NextResponse.json({
      incidenciaId: Number(result.insertId),
      tipo,
      creado: true,
    });
  } catch (err) {
    console.error("anexo incidencia", err);
    return NextResponse.json(
      { error: "No se pudo preparar la incidencia para adjuntos." },
      { status: 500 },
    );
  }
}
