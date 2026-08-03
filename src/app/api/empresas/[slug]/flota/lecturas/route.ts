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
    `SELECT l.id, l.vehiculo_id, l.km, l.fecha_lectura, l.nota, l.registrado_por, v.placa
     FROM flota_lecturas l
     INNER JOIN flota_vehiculos v ON v.id = l.vehiculo_id
     WHERE l.empresa_id = ? ${vehiculoId ? "AND l.vehiculo_id = ?" : ""}
     ORDER BY l.fecha_lectura DESC, l.id DESC
     LIMIT 200`,
    vehiculoId ? [guard.empresa.id, vehiculoId] : [guard.empresa.id],
  );
  return NextResponse.json({ lecturas: rows });
}

const schema = z.object({
  vehiculoId: z.number().int().positive(),
  km: z.number().int().nonnegative(),
  fechaLectura: z.string().min(8),
  nota: z.string().optional(),
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
    "SELECT id, km_actual FROM flota_vehiculos WHERE id = ? AND empresa_id = ? LIMIT 1",
    [d.vehiculoId, guard.empresa.id],
  );
  if (!veh[0]) {
    return NextResponse.json({ error: "Vehículo no encontrado." }, { status: 404 });
  }

  const result = await execute(
    `INSERT INTO flota_lecturas (empresa_id, vehiculo_id, km, fecha_lectura, nota, registrado_por)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      guard.empresa.id,
      d.vehiculoId,
      d.km,
      d.fechaLectura,
      d.nota ?? null,
      guard.session.username,
    ],
  );

  if (d.km >= Number(veh[0].km_actual ?? 0)) {
    await execute(
      "UPDATE flota_vehiculos SET km_actual = ? WHERE id = ? AND empresa_id = ?",
      [d.km, d.vehiculoId, guard.empresa.id],
    );
  }

  return NextResponse.json({ id: result.insertId, mensaje: "Lectura registrada." });
}
