import { NextResponse } from "next/server";
import { z } from "zod";
import type { RowDataPacket } from "mysql2";
import { execute, query } from "@/lib/db";
import { requireTenantFlota, requireTenantFlotaAny } from "@/lib/tenant";
import { asegurarSchemaFlota } from "@/lib/flota/schema";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantFlotaAny(
    slug,
    [
      "flota_vehiculos",
      "flota_lecturas",
      "flota_servicios",
      "flota_piloto",
      "flota_reportes",
    ],
    "ver",
  );
  if (guard.error) return guard.error;

  try {
    await asegurarSchemaFlota();
  } catch {
    /* columnas parciales ok */
  }

  const rows = await query<RowDataPacket[]>(
    `SELECT id, placa, marca, modelo, descripcion, color, tipo_combustible,
            chasis, capacidad, credito, empresa_activo, nit, condicion_propiedad,
            seguros, km_actual, km_intervalo_servicio, km_ultimo_servicio,
            fecha_ultimo_servicio, en_taller, fecha_entrada_taller, motivo_taller,
            estado, activo, notas
     FROM flota_vehiculos WHERE empresa_id = ?
     ORDER BY activo DESC, placa`,
    [guard.empresa.id],
  );
  return NextResponse.json({ vehiculos: rows });
}

const schema = z.object({
  placa: z.string().min(1),
  marca: z.string().optional(),
  modelo: z.string().optional(),
  descripcion: z.string().optional(),
  color: z.string().optional(),
  tipoCombustible: z.string().optional(),
  chasis: z.string().optional(),
  capacidad: z.string().optional(),
  kmActual: z.number().int().nonnegative().default(0),
  kmIntervaloServicio: z.number().int().positive().default(10000),
  credito: z.string().optional(),
  empresaActivo: z.string().optional(),
  nit: z.string().optional(),
  condicionPropiedad: z.string().optional(),
  seguros: z.string().optional(),
  notas: z.string().optional(),
  activo: z.boolean().optional(),
});

export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantFlota(slug, "flota_vehiculos", "crear");
  if (guard.error) return guard.error;

  try {
    await asegurarSchemaFlota();
  } catch {
    /* ignore */
  }

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }
  const d = parsed.data;
  const placa = d.placa.trim().toUpperCase();

  const dup = await query<RowDataPacket[]>(
    "SELECT id FROM flota_vehiculos WHERE empresa_id = ? AND placa = ? LIMIT 1",
    [guard.empresa.id, placa],
  );
  if (dup[0]) {
    return NextResponse.json(
      { error: `Ya existe la placa ${placa}.` },
      { status: 409 },
    );
  }

  try {
    const result = await execute(
      `INSERT INTO flota_vehiculos
        (empresa_id, placa, marca, modelo, descripcion, color, tipo_combustible,
         chasis, capacidad, credito, empresa_activo, nit, condicion_propiedad,
         seguros, km_actual, km_intervalo_servicio, km_ultimo_servicio, notas, activo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        guard.empresa.id,
        placa,
        d.marca ?? null,
        d.modelo ?? null,
        d.descripcion ?? null,
        d.color ?? null,
        d.tipoCombustible ?? "diesel",
        d.chasis ?? null,
        d.capacidad ?? null,
        d.credito ?? null,
        d.empresaActivo ?? null,
        d.nit ?? null,
        d.condicionPropiedad ?? null,
        d.seguros ?? null,
        d.kmActual,
        d.kmIntervaloServicio,
        d.kmActual,
        d.notas ?? null,
        d.activo === false ? 0 : 1,
      ],
    );
    return NextResponse.json({
      id: result.insertId,
      mensaje: "Vehículo registrado.",
    });
  } catch {
    // fallback columnas mínimas
    const result = await execute(
      `INSERT INTO flota_vehiculos
        (empresa_id, placa, marca, modelo, km_actual, km_intervalo_servicio, km_ultimo_servicio)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        guard.empresa.id,
        placa,
        d.marca ?? null,
        d.modelo ?? null,
        d.kmActual,
        d.kmIntervaloServicio,
        d.kmActual,
      ],
    );
    return NextResponse.json({
      id: result.insertId,
      mensaje: "Vehículo registrado.",
    });
  }
}

const patchSchema = z.object({
  id: z.number().int().positive(),
  enTaller: z.boolean().optional(),
  motivoTaller: z.string().optional(),
  estado: z.string().optional(),
  activo: z.boolean().optional(),
  marca: z.string().optional(),
  modelo: z.string().optional(),
  descripcion: z.string().optional(),
  color: z.string().optional(),
  kmIntervaloServicio: z.number().int().positive().optional(),
  notas: z.string().optional(),
});

export async function PATCH(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantFlota(slug, "flota_vehiculos", "editar");
  if (guard.error) return guard.error;

  const parsed = patchSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }
  const d = parsed.data;

  try {
    await execute(
      `UPDATE flota_vehiculos SET
        en_taller = COALESCE(?, en_taller),
        fecha_entrada_taller = CASE
          WHEN ? = 1 THEN CURDATE()
          WHEN ? = 0 THEN NULL
          ELSE fecha_entrada_taller END,
        motivo_taller = CASE
          WHEN ? = 0 THEN NULL
          WHEN ? IS NOT NULL THEN ?
          ELSE motivo_taller END,
        estado = COALESCE(?, estado),
        activo = COALESCE(?, activo),
        marca = COALESCE(?, marca),
        modelo = COALESCE(?, modelo),
        descripcion = COALESCE(?, descripcion),
        color = COALESCE(?, color),
        km_intervalo_servicio = COALESCE(?, km_intervalo_servicio),
        notas = COALESCE(?, notas)
       WHERE id = ? AND empresa_id = ?`,
      [
        d.enTaller == null ? null : d.enTaller ? 1 : 0,
        d.enTaller == null ? null : d.enTaller ? 1 : 0,
        d.enTaller == null ? null : d.enTaller ? 0 : 1,
        d.enTaller == null ? null : d.enTaller ? 1 : 0,
        d.motivoTaller ?? null,
        d.motivoTaller ?? null,
        d.estado ?? null,
        d.activo == null ? null : d.activo ? 1 : 0,
        d.marca ?? null,
        d.modelo ?? null,
        d.descripcion ?? null,
        d.color ?? null,
        d.kmIntervaloServicio ?? null,
        d.notas ?? null,
        d.id,
        guard.empresa.id,
      ],
    );
  } catch {
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
  }
  return NextResponse.json({ mensaje: "Vehículo actualizado." });
}

export async function DELETE(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantFlota(slug, "flota_vehiculos", "eliminar");
  if (guard.error) return guard.error;

  const id = Number(new URL(req.url).searchParams.get("id") ?? 0);
  if (!id) {
    return NextResponse.json({ error: "ID requerido." }, { status: 400 });
  }
  await execute(
    "DELETE FROM flota_vehiculos WHERE id = ? AND empresa_id = ?",
    [id, guard.empresa.id],
  );
  return NextResponse.json({ mensaje: "Vehículo eliminado." });
}
