import { NextResponse } from "next/server";
import { z } from "zod";
import type { RowDataPacket } from "mysql2";
import { execute, query } from "@/lib/db";
import { requireTenantRrhh } from "@/lib/tenant";

type Ctx = { params: Promise<{ slug: string; id: string }> };

const actualizarSchema = z.object({
  empleadoId: z.number().int().positive(),
  tipo: z.string().trim().min(1).max(80),
  monto: z.number().positive(),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notas: z.string().max(4000).optional(),
});

const anularSchema = z.object({
  motivo: z.string().trim().min(3).max(500),
});

async function explicarBloqueo(empresaId: number, id: number) {
  const rows = await query<RowDataPacket[]>(
    `SELECT p.tipo,
            EXISTS (
              SELECT 1 FROM rrhh_planilla_periodos pp
              WHERE pp.empresa_id = p.empresa_id
                AND p.fecha BETWEEN pp.fecha_inicio AND pp.fecha_fin
                AND pp.estado IN ('Generada', 'Cerrada')
            ) AS en_planilla
     FROM rrhh_prestaciones p
     WHERE p.id = ? AND p.empresa_id = ? LIMIT 1`,
    [id, empresaId],
  );
  if (!rows[0]) return "Prestación no encontrada.";
  if (String(rows[0].tipo).startsWith("Anulada · ")) {
    return "La prestación ya está anulada.";
  }
  if (Number(rows[0].en_planilla) === 1) {
    return "No puede modificarse porque su periodo de planilla ya fue generado o cerrado.";
  }
  return "No se pudo actualizar la prestación con los datos indicados.";
}

export async function PATCH(req: Request, ctx: Ctx) {
  const { slug, id: idRaw } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "prestaciones", "editar");
  if (guard.error) return guard.error;
  const id = Number(idRaw);
  const parsed = actualizarSchema.safeParse(await req.json());
  if (!Number.isInteger(id) || id <= 0 || !parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }
  const d = parsed.data;
  const result = await execute(
    `UPDATE rrhh_prestaciones p
     SET p.id_empleado = ?, p.tipo = ?, p.monto = ?, p.fecha = ?, p.notas = ?
     WHERE p.id = ? AND p.empresa_id = ?
       AND p.tipo NOT LIKE 'Anulada · %'
       AND EXISTS (
         SELECT 1 FROM empleados e
         WHERE e.id = ? AND e.empresa_id = p.empresa_id
       )
       AND NOT EXISTS (
         SELECT 1 FROM rrhh_planilla_periodos pp
         WHERE pp.empresa_id = p.empresa_id
           AND p.fecha BETWEEN pp.fecha_inicio AND pp.fecha_fin
           AND pp.estado IN ('Generada', 'Cerrada')
       )
       AND NOT EXISTS (
         SELECT 1 FROM rrhh_planilla_periodos pp
         WHERE pp.empresa_id = p.empresa_id
           AND ? BETWEEN pp.fecha_inicio AND pp.fecha_fin
           AND pp.estado IN ('Generada', 'Cerrada')
       )`,
    [
      d.empleadoId,
      d.tipo,
      d.monto,
      d.fecha,
      d.notas?.trim() || null,
      id,
      guard.empresa.id,
      d.empleadoId,
      d.fecha,
    ],
  );
  if (!result.affectedRows) {
    return NextResponse.json(
      { error: await explicarBloqueo(guard.empresa.id, id) },
      { status: 409 },
    );
  }
  return NextResponse.json({ mensaje: "Prestación actualizada." });
}

export async function DELETE(req: Request, ctx: Ctx) {
  const { slug, id: idRaw } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "prestaciones", "eliminar");
  if (guard.error) return guard.error;
  const id = Number(idRaw);
  const parsed = anularSchema.safeParse(await req.json());
  if (!Number.isInteger(id) || id <= 0 || !parsed.success) {
    return NextResponse.json(
      { error: "Indica un motivo de anulación válido." },
      { status: 400 },
    );
  }
  const result = await execute(
    `UPDATE rrhh_prestaciones p
     SET p.notas = CONCAT(
           '[ANULADA por ', ?, ' el ', DATE_FORMAT(NOW(), '%Y-%m-%d %H:%i'),
           '. Motivo: ', ?, '. Monto original: Q', FORMAT(p.monto, 2), '] ',
           COALESCE(p.notas, '')
         ),
         p.tipo = LEFT(CONCAT('Anulada · ', p.tipo), 80),
         p.monto = 0
     WHERE p.id = ? AND p.empresa_id = ?
       AND p.tipo NOT LIKE 'Anulada · %'
       AND NOT EXISTS (
         SELECT 1 FROM rrhh_planilla_periodos pp
         WHERE pp.empresa_id = p.empresa_id
           AND p.fecha BETWEEN pp.fecha_inicio AND pp.fecha_fin
           AND pp.estado IN ('Generada', 'Cerrada')
       )`,
    [guard.session.username, parsed.data.motivo, id, guard.empresa.id],
  );
  if (!result.affectedRows) {
    return NextResponse.json(
      { error: await explicarBloqueo(guard.empresa.id, id) },
      { status: 409 },
    );
  }
  return NextResponse.json({ mensaje: "Prestación anulada y conservada en el historial." });
}
