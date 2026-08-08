import { NextResponse } from "next/server";
import { z } from "zod";
import type { RowDataPacket } from "mysql2";
import { execute, query } from "@/lib/db";
import { requireTenantFlotaAny } from "@/lib/tenant";
import { actualizarKmActualVehiculo } from "@/lib/flota/km-vehiculo";
import {
  asegurarSchemaFlota,
  asegurarSchemaFlotaLectura,
} from "@/lib/flota/schema";
import { normalizarNombrePiloto } from "@/lib/flota/pilotos";
import { ahoraLocal } from "@/lib/rrhh/dates";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantFlotaAny(
    slug,
    ["flota_lecturas", "flota_piloto", "flota_reportes"],
    "ver",
  );
  if (guard.error) return guard.error;

  try {
    await asegurarSchemaFlotaLectura();
  } catch {
    /* ok */
  }

  const vehiculoId = Number(new URL(req.url).searchParams.get("vehiculoId") ?? 0);
  const rows = await query<RowDataPacket[]>(
    `SELECT l.id, l.vehiculo_id, l.km, l.fecha_lectura, l.nota, l.conductor,
            l.registrado_por, l.viaje_id, l.latitud, l.longitud, l.capturado_en,
            v.placa,
            j.destino AS viaje_destino, j.estado AS viaje_estado,
            j.hora_salida AS viaje_hora_salida, j.hora_llegada AS viaje_hora_llegada,
            j.plan_id,
            p.codigo AS plan_codigo
     FROM flota_lecturas l
     INNER JOIN flota_vehiculos v ON v.id = l.vehiculo_id
     LEFT JOIN flota_viajes j ON j.id = l.viaje_id
     LEFT JOIN tms_planes_viaje p ON p.id = j.plan_id
     WHERE l.empresa_id = ? ${vehiculoId ? "AND l.vehiculo_id = ?" : ""}
     ORDER BY l.fecha_lectura DESC, l.id DESC
     LIMIT 200`,
    vehiculoId ? [guard.empresa.id, vehiculoId] : [guard.empresa.id],
  ).catch(async () =>
    query<RowDataPacket[]>(
      `SELECT l.id, l.vehiculo_id, l.km, l.fecha_lectura, l.nota, l.conductor,
              l.registrado_por, v.placa, NULL AS viaje_id
       FROM flota_lecturas l
       INNER JOIN flota_vehiculos v ON v.id = l.vehiculo_id
       WHERE l.empresa_id = ? ${vehiculoId ? "AND l.vehiculo_id = ?" : ""}
       ORDER BY l.fecha_lectura DESC, l.id DESC
       LIMIT 200`,
      vehiculoId ? [guard.empresa.id, vehiculoId] : [guard.empresa.id],
    ),
  );

  const lecturaIds = rows.map((r) => Number(r.id));
  const viajeIds = [
    ...new Set(
      rows
        .map((r) => (r.viaje_id != null ? Number(r.viaje_id) : 0))
        .filter((id) => id > 0),
    ),
  ];
  const propiasMap = new Map<number, number>();
  const viajeEvMap = new Map<number, number>();

  if (lecturaIds.length) {
    try {
      const propias = await query<RowDataPacket[]>(
        `SELECT lectura_id, COUNT(*) AS n FROM flota_lectura_evidencias
         WHERE empresa_id = ? AND lectura_id IN (${lecturaIds.map(() => "?").join(",")})
         GROUP BY lectura_id`,
        [guard.empresa.id, ...lecturaIds],
      );
      for (const a of propias) propiasMap.set(Number(a.lectura_id), Number(a.n));
    } catch {
      /* tabla ausente */
    }
  }
  if (viajeIds.length) {
    try {
      const deViaje = await query<RowDataPacket[]>(
        `SELECT viaje_id, COUNT(*) AS n FROM flota_viaje_evidencias
         WHERE empresa_id = ? AND viaje_id IN (${viajeIds.map(() => "?").join(",")})
         GROUP BY viaje_id`,
        [guard.empresa.id, ...viajeIds],
      );
      for (const a of deViaje) viajeEvMap.set(Number(a.viaje_id), Number(a.n));
    } catch {
      /* ok */
    }
  }

  return NextResponse.json({
    lecturas: rows.map((r) => {
      const propias = propiasMap.get(Number(r.id)) ?? 0;
      const deViaje =
        r.viaje_id != null ? (viajeEvMap.get(Number(r.viaje_id)) ?? 0) : 0;
      return {
        ...r,
        evidencias: propias + deViaje,
        evidencias_propias: propias,
        evidencias_viaje: deViaje,
      };
    }),
  });
}

const schema = z.object({
  vehiculoId: z.number().int().positive(),
  km: z.number().int().nonnegative(),
  fechaLectura: z.string().min(8),
  nota: z.string().optional(),
  conductor: z.string().optional(),
  latitud: z.number().optional().nullable(),
  longitud: z.number().optional().nullable(),
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

  const kmActual = Number(veh[0].km_actual ?? 0);
  if (d.km < kmActual) {
    return NextResponse.json(
      {
        error: `Km (${d.km.toLocaleString("es-GT")}) no puede ser menor al km actual de ${veh[0].placa} (${kmActual.toLocaleString("es-GT")}). Debe ser mayor o igual.`,
      },
      { status: 400 },
    );
  }

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

  const ahora = ahoraLocal();
  let result;
  try {
    result = await execute(
      `INSERT INTO flota_lecturas
        (empresa_id, vehiculo_id, km, fecha_lectura, nota, conductor, registrado_por,
         latitud, longitud, capturado_en)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        guard.empresa.id,
        d.vehiculoId,
        d.km,
        d.fechaLectura,
        nota,
        conductor || null,
        guard.session.username,
        d.latitud ?? null,
        d.longitud ?? null,
        ahora,
      ],
    );
  } catch {
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
  }

  await actualizarKmActualVehiculo(d.vehiculoId, d.km);

  return NextResponse.json({
    id: result.insertId,
    vehiculoId: d.vehiculoId,
    placa: String(veh[0].placa ?? ""),
    km: d.km,
    mensaje: `Lectura registrada en ${veh[0].placa}.`,
  });
}
