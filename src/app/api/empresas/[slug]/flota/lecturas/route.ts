import { NextResponse } from "next/server";
import { z } from "zod";
import type { RowDataPacket } from "mysql2";
import { execute, query } from "@/lib/db";
import { requireTenantFlotaAny } from "@/lib/tenant";
import { asegurarSchemaFlota } from "@/lib/flota/schema";
import { normalizarNombrePiloto } from "@/lib/flota/pilotos";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantFlotaAny(
    slug,
    ["flota_lecturas", "flota_piloto"],
    "ver",
  );
  if (guard.error) return guard.error;

  try {
    await asegurarSchemaFlota();
  } catch {
    /* ok */
  }

  const vehiculoId = Number(new URL(req.url).searchParams.get("vehiculoId") ?? 0);
  const rows = await query<RowDataPacket[]>(
    `SELECT l.id, l.vehiculo_id, l.km, l.fecha_lectura, l.nota, l.conductor,
            l.registrado_por, v.placa
     FROM flota_lecturas l
     INNER JOIN flota_vehiculos v ON v.id = l.vehiculo_id
     WHERE l.empresa_id = ? ${vehiculoId ? "AND l.vehiculo_id = ?" : ""}
     ORDER BY l.fecha_lectura DESC, l.id DESC
     LIMIT 200`,
    vehiculoId ? [guard.empresa.id, vehiculoId] : [guard.empresa.id],
  ).catch(async () =>
    query<RowDataPacket[]>(
      `SELECT l.id, l.vehiculo_id, l.km, l.fecha_lectura, l.nota, l.registrado_por, v.placa
       FROM flota_lecturas l
       INNER JOIN flota_vehiculos v ON v.id = l.vehiculo_id
       WHERE l.empresa_id = ? ${vehiculoId ? "AND l.vehiculo_id = ?" : ""}
       ORDER BY l.fecha_lectura DESC, l.id DESC
       LIMIT 200`,
      vehiculoId ? [guard.empresa.id, vehiculoId] : [guard.empresa.id],
    ),
  );
  return NextResponse.json({ lecturas: rows });
}

const schema = z.object({
  vehiculoId: z.number().int().positive(),
  km: z.number().int().nonnegative(),
  fechaLectura: z.string().min(8),
  nota: z.string().optional(),
  conductor: z.string().optional(),
});

export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantFlotaAny(
    slug,
    ["flota_lecturas", "flota_piloto"],
    "crear",
  );
  if (guard.error) return guard.error;

  try {
    await asegurarSchemaFlota();
  } catch {
    /* ok */
  }

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }
  const d = parsed.data;
  const conductor = (d.conductor ?? "").trim() || (d.nota ?? "").trim();
  const nota = (d.nota ?? "").trim() || conductor || null;

  const veh = await query<RowDataPacket[]>(
    `SELECT id, placa, km_actual, en_taller, activo, estado
     FROM flota_vehiculos WHERE id = ? AND empresa_id = ? LIMIT 1`,
    [d.vehiculoId, guard.empresa.id],
  );
  if (!veh[0]) {
    return NextResponse.json({ error: "Vehículo no encontrado." }, { status: 404 });
  }
  if (Number(veh[0].activo) === 0) {
    return NextResponse.json({ error: "Vehículo inactivo." }, { status: 400 });
  }

  // No lectura / no "salida" si está en taller
  if (
    Number(veh[0].en_taller) === 1 ||
    String(veh[0].estado ?? "")
      .toLowerCase()
      .includes("taller")
  ) {
    return NextResponse.json(
      {
        error: `${veh[0].placa} está en taller. No se puede registrar lectura ni enviarlo a ruta hasta que salga de servicio.`,
      },
      { status: 409 },
    );
  }

  // Unidad ya en ruta
  const abiertoVeh = await query<RowDataPacket[]>(
    `SELECT id, piloto_nombre FROM flota_viajes
     WHERE empresa_id = ? AND vehiculo_id = ? AND estado = 'abierto' LIMIT 1`,
    [guard.empresa.id, d.vehiculoId],
  );
  if (abiertoVeh[0]) {
    return NextResponse.json(
      {
        error: `${veh[0].placa} ya está en ruta con ${abiertoVeh[0].piloto_nombre}. Cierra la llegada primero.`,
      },
      { status: 409 },
    );
  }

  // Mismo piloto (sin importar mayúsculas) no puede tener otro viaje abierto
  if (conductor.length >= 2) {
    const norm = normalizarNombrePiloto(conductor);
    const abiertos = await query<RowDataPacket[]>(
      `SELECT v.id, v.piloto_nombre, v.piloto_nombre_norm, ve.placa
       FROM flota_viajes v
       INNER JOIN flota_vehiculos ve ON ve.id = v.vehiculo_id
       WHERE v.empresa_id = ? AND v.estado = 'abierto'`,
      [guard.empresa.id],
    ).catch(async () =>
      query<RowDataPacket[]>(
        `SELECT v.id, v.piloto_nombre, ve.placa
         FROM flota_viajes v
         INNER JOIN flota_vehiculos ve ON ve.id = v.vehiculo_id
         WHERE v.empresa_id = ? AND v.estado = 'abierto'`,
        [guard.empresa.id],
      ),
    );
    const mismo = abiertos.find((row) => {
      const rowNorm =
        (row.piloto_nombre_norm
          ? String(row.piloto_nombre_norm)
          : null) || normalizarNombrePiloto(String(row.piloto_nombre ?? ""));
      return rowNorm === norm;
    });
    if (mismo) {
      return NextResponse.json(
        {
          error: `El piloto "${conductor}" ya tiene viaje abierto en ${mismo.placa} (sin importar mayúsculas). Cierra esa llegada primero.`,
        },
        { status: 409 },
      );
    }
  }

  let result;
  try {
    result = await execute(
      `INSERT INTO flota_lecturas
        (empresa_id, vehiculo_id, km, fecha_lectura, nota, conductor, registrado_por)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        guard.empresa.id,
        d.vehiculoId,
        d.km,
        d.fechaLectura,
        nota,
        conductor || null,
        guard.session.username,
      ],
    );
  } catch {
    result = await execute(
      `INSERT INTO flota_lecturas
        (empresa_id, vehiculo_id, km, fecha_lectura, nota, registrado_por)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        guard.empresa.id,
        d.vehiculoId,
        d.km,
        d.fechaLectura,
        nota,
        guard.session.username,
      ],
    );
  }

  if (d.km >= Number(veh[0].km_actual ?? 0)) {
    await execute(
      "UPDATE flota_vehiculos SET km_actual = ? WHERE id = ? AND empresa_id = ?",
      [d.km, d.vehiculoId, guard.empresa.id],
    );
  }

  return NextResponse.json({
    id: result.insertId,
    mensaje: "Lectura registrada.",
  });
}
