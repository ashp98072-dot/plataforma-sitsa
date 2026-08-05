import { NextResponse } from "next/server";
import { z } from "zod";
import type { RowDataPacket } from "mysql2";
import { execute, query } from "@/lib/db";
import { requireTenantFlota } from "@/lib/tenant";
import { asegurarSchemaFlota } from "@/lib/flota/schema";
import { ahoraLocal } from "@/lib/rrhh/dates";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantFlota(slug, "flota_piloto", "ver");
  if (guard.error) return guard.error;

  try {
    await asegurarSchemaFlota();
  } catch {
    /* ok */
  }

  const viajes = await query<RowDataPacket[]>(
    `SELECT v.id, v.vehiculo_id, v.piloto_nombre, v.km_salida, v.km_llegada,
            v.hora_salida, v.hora_llegada, v.destino, v.observaciones, v.estado,
            ve.placa
     FROM flota_viajes v
     INNER JOIN flota_vehiculos ve ON ve.id = v.vehiculo_id
     WHERE v.empresa_id = ?
     ORDER BY v.hora_salida DESC
     LIMIT 100`,
    [guard.empresa.id],
  );
  const abiertos = viajes.filter((x) => String(x.estado) === "abierto");
  return NextResponse.json({ viajes, abiertos });
}

const salidaSchema = z.object({
  accion: z.literal("salida"),
  vehiculoId: z.number().int().positive(),
  pilotoNombre: z.string().min(2),
  kmSalida: z.number().int().nonnegative(),
  destino: z.string().optional(),
});

const llegadaSchema = z.object({
  accion: z.literal("llegada"),
  viajeId: z.number().int().positive(),
  kmLlegada: z.number().int().nonnegative(),
  pilotoNombre: z.string().optional(),
  observaciones: z.string().optional(),
});

export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantFlota(slug, "flota_piloto", "crear");
  if (guard.error) return guard.error;

  try {
    await asegurarSchemaFlota();
  } catch {
    /* ok */
  }

  const body = await req.json();
  const ahora = ahoraLocal();

  if (body?.accion === "salida") {
    const parsed = salidaSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Datos de salida inválidos." }, { status: 400 });
    }
    const d = parsed.data;

    const veh = await query<RowDataPacket[]>(
      `SELECT id, placa, en_taller, km_actual FROM flota_vehiculos
       WHERE id = ? AND empresa_id = ? LIMIT 1`,
      [d.vehiculoId, guard.empresa.id],
    );
    if (!veh[0]) {
      return NextResponse.json({ error: "Vehículo no encontrado." }, { status: 404 });
    }
    if (Number(veh[0].en_taller) === 1) {
      return NextResponse.json(
        { error: `${veh[0].placa} está en taller.` },
        { status: 400 },
      );
    }

    const abiertoVeh = await query<RowDataPacket[]>(
      `SELECT id FROM flota_viajes
       WHERE empresa_id = ? AND vehiculo_id = ? AND estado = 'abierto' LIMIT 1`,
      [guard.empresa.id, d.vehiculoId],
    );
    if (abiertoVeh[0]) {
      return NextResponse.json(
        { error: "Ese vehículo ya tiene un viaje abierto." },
        { status: 409 },
      );
    }

    const r = await execute(
      `INSERT INTO flota_viajes
        (empresa_id, vehiculo_id, piloto_nombre, piloto_usuario_id, km_salida,
         hora_salida, destino, estado)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'abierto')`,
      [
        guard.empresa.id,
        d.vehiculoId,
        d.pilotoNombre.trim(),
        guard.session.id,
        d.kmSalida,
        ahora,
        d.destino ?? null,
      ],
    );

    await execute(
      `INSERT INTO flota_lecturas
        (empresa_id, vehiculo_id, km, fecha_lectura, nota, conductor, registrado_por)
       VALUES (?, ?, ?, CURDATE(), ?, ?, ?)`,
      [
        guard.empresa.id,
        d.vehiculoId,
        d.kmSalida,
        d.destino ? `Salida viaje → ${d.destino}` : "Salida viaje",
        d.pilotoNombre.trim(),
        guard.session.username,
      ],
    ).catch(async () => {
      await execute(
        `INSERT INTO flota_lecturas
          (empresa_id, vehiculo_id, km, fecha_lectura, nota, registrado_por)
         VALUES (?, ?, ?, CURDATE(), ?, ?)`,
        [
          guard.empresa.id,
          d.vehiculoId,
          d.kmSalida,
          "Salida viaje",
          guard.session.username,
        ],
      );
    });

    await execute(
      `UPDATE flota_vehiculos SET km_actual = GREATEST(COALESCE(km_actual,0), ?)
       WHERE id = ? AND empresa_id = ?`,
      [d.kmSalida, d.vehiculoId, guard.empresa.id],
    );

    return NextResponse.json({
      id: r.insertId,
      mensaje: `Salida de ${veh[0].placa} registrada (${d.pilotoNombre}).`,
    });
  }

  if (body?.accion === "llegada") {
    const parsed = llegadaSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Datos de llegada inválidos." }, { status: 400 });
    }
    const d = parsed.data;
    const viaje = await query<RowDataPacket[]>(
      `SELECT v.*, ve.placa FROM flota_viajes v
       INNER JOIN flota_vehiculos ve ON ve.id = v.vehiculo_id
       WHERE v.id = ? AND v.empresa_id = ? LIMIT 1`,
      [d.viajeId, guard.empresa.id],
    );
    if (!viaje[0] || String(viaje[0].estado) !== "abierto") {
      return NextResponse.json(
        { error: "Viaje abierto no encontrado." },
        { status: 404 },
      );
    }
    if (d.kmLlegada < Number(viaje[0].km_salida)) {
      return NextResponse.json(
        { error: "Km de llegada no puede ser menor que la salida." },
        { status: 400 },
      );
    }

    await execute(
      `UPDATE flota_viajes SET
        km_llegada = ?, hora_llegada = ?, estado = 'cerrado',
        observaciones = COALESCE(?, observaciones),
        piloto_nombre = COALESCE(?, piloto_nombre)
       WHERE id = ? AND empresa_id = ?`,
      [
        d.kmLlegada,
        ahora,
        d.observaciones ?? null,
        d.pilotoNombre?.trim() || null,
        d.viajeId,
        guard.empresa.id,
      ],
    );

    await execute(
      `INSERT INTO flota_lecturas
        (empresa_id, vehiculo_id, km, fecha_lectura, nota, conductor, registrado_por)
       VALUES (?, ?, ?, CURDATE(), 'Llegada viaje', ?, ?)`,
      [
        guard.empresa.id,
        Number(viaje[0].vehiculo_id),
        d.kmLlegada,
        d.pilotoNombre?.trim() || String(viaje[0].piloto_nombre),
        guard.session.username,
      ],
    ).catch(async () => {
      await execute(
        `INSERT INTO flota_lecturas
          (empresa_id, vehiculo_id, km, fecha_lectura, nota, registrado_por)
         VALUES (?, ?, ?, CURDATE(), 'Llegada viaje', ?)`,
        [
          guard.empresa.id,
          Number(viaje[0].vehiculo_id),
          d.kmLlegada,
          guard.session.username,
        ],
      );
    });

    await execute(
      `UPDATE flota_vehiculos SET km_actual = GREATEST(COALESCE(km_actual,0), ?)
       WHERE id = ? AND empresa_id = ?`,
      [d.kmLlegada, Number(viaje[0].vehiculo_id), guard.empresa.id],
    );

    const recorridos = d.kmLlegada - Number(viaje[0].km_salida);
    return NextResponse.json({
      mensaje: `Llegada de ${viaje[0].placa}: ${recorridos.toLocaleString("es-GT")} km.`,
    });
  }

  return NextResponse.json({ error: "Acción inválida." }, { status: 400 });
}
