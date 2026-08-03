import { NextResponse } from "next/server";
import { z } from "zod";
import type { RowDataPacket } from "mysql2";
import { execute, query } from "@/lib/db";
import { requireTenantModulo } from "@/lib/tenant";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantModulo(slug, "flota");
  if (guard.error) return guard.error;

  const vehiculoId = Number(new URL(req.url).searchParams.get("vehiculoId") ?? 0);
  const rows = await query<RowDataPacket[]>(
    `SELECT s.id, s.vehiculo_id, s.tipo, s.km_servicio, s.fecha_servicio, s.costo, s.descripcion, v.placa
     FROM flota_servicios s
     INNER JOIN flota_vehiculos v ON v.id = s.vehiculo_id
     WHERE s.empresa_id = ? ${vehiculoId ? "AND s.vehiculo_id = ?" : ""}
     ORDER BY s.fecha_servicio DESC
     LIMIT 200`,
    vehiculoId ? [guard.empresa.id, vehiculoId] : [guard.empresa.id],
  );
  return NextResponse.json({ servicios: rows });
}

const schema = z.object({
  vehiculoId: z.number().int().positive(),
  tipo: z.string().min(1),
  kmServicio: z.number().int().nonnegative().optional(),
  fechaServicio: z.string().min(8),
  costo: z.number().nonnegative().default(0),
  descripcion: z.string().optional(),
});

export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantModulo(slug, "flota", true);
  if (guard.error) return guard.error;

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }
  const d = parsed.data;

  const veh = await query<RowDataPacket[]>(
    "SELECT id FROM flota_vehiculos WHERE id = ? AND empresa_id = ? LIMIT 1",
    [d.vehiculoId, guard.empresa.id],
  );
  if (!veh[0]) {
    return NextResponse.json({ error: "Vehículo no encontrado." }, { status: 404 });
  }

  const result = await execute(
    `INSERT INTO flota_servicios
      (empresa_id, vehiculo_id, tipo, km_servicio, fecha_servicio, costo, descripcion)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      guard.empresa.id,
      d.vehiculoId,
      d.tipo,
      d.kmServicio ?? null,
      d.fechaServicio,
      d.costo,
      d.descripcion ?? null,
    ],
  );

  await execute(
    `UPDATE flota_vehiculos SET
      km_ultimo_servicio = COALESCE(?, km_ultimo_servicio),
      fecha_ultimo_servicio = ?,
      en_taller = 0,
      fecha_entrada_taller = NULL
     WHERE id = ? AND empresa_id = ?`,
    [d.kmServicio ?? null, d.fechaServicio, d.vehiculoId, guard.empresa.id],
  );

  return NextResponse.json({ id: result.insertId, mensaje: "Servicio registrado." });
}