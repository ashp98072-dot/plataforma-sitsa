import { NextResponse } from "next/server";
import { z } from "zod";
import type { RowDataPacket } from "mysql2";
import { execute, query } from "@/lib/db";
import { requireTenantModulo } from "@/lib/tenant";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantModulo(slug, "flota");
  if (guard.error) return guard.error;

  const rows = await query<RowDataPacket[]>(
    `SELECT id, placa, marca, modelo, km_actual, km_intervalo_servicio, km_ultimo_servicio,
            fecha_ultimo_servicio, en_taller, fecha_entrada_taller, estado
     FROM flota_vehiculos WHERE empresa_id = ? ORDER BY placa`,
    [guard.empresa.id],
  );
  return NextResponse.json({ vehiculos: rows });
}

const schema = z.object({
  placa: z.string().min(1),
  marca: z.string().optional(),
  modelo: z.string().optional(),
  kmActual: z.number().int().nonnegative().default(0),
  kmIntervaloServicio: z.number().int().positive().default(10000),
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
  const result = await execute(
    `INSERT INTO flota_vehiculos
      (empresa_id, placa, marca, modelo, km_actual, km_intervalo_servicio, km_ultimo_servicio)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      guard.empresa.id,
      d.placa,
      d.marca ?? null,
      d.modelo ?? null,
      d.kmActual,
      d.kmIntervaloServicio,
      d.kmActual,
    ],
  );
  return NextResponse.json({ id: result.insertId, mensaje: "Vehículo registrado." });
}

const patchSchema = z.object({
  id: z.number().int().positive(),
  enTaller: z.boolean().optional(),
  estado: z.string().optional(),
});

export async function PATCH(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantModulo(slug, "flota", true);
  if (guard.error) return guard.error;

  const parsed = patchSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }
  const d = parsed.data;
  await execute(
    `UPDATE flota_vehiculos SET
      en_taller = COALESCE(?, en_taller),
      fecha_entrada_taller = CASE WHEN ? = 1 THEN CURDATE() WHEN ? = 0 THEN NULL ELSE fecha_entrada_taller END,
      estado = COALESCE(?, estado)
     WHERE id = ? AND empresa_id = ?`,
    [
      d.enTaller == null ? null : d.enTaller ? 1 : 0,
      d.enTaller == null ? null : d.enTaller ? 1 : 0,
      d.enTaller == null ? null : d.enTaller ? 0 : 1,
      d.estado ?? null,
      d.id,
      guard.empresa.id,
    ],
  );
  return NextResponse.json({ mensaje: "Vehículo actualizado." });
}
