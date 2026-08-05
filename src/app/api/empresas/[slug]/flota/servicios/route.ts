import { NextResponse } from "next/server";
import { z } from "zod";
import type { RowDataPacket } from "mysql2";
import { execute, query } from "@/lib/db";
import { requireTenantFlota } from "@/lib/tenant";
import { asegurarSchemaFlota } from "@/lib/flota/schema";
import { ahoraLocal } from "@/lib/rrhh/dates";
import { contentTypeFor, guardarUpload } from "@/lib/uploads";

type Ctx = { params: Promise<{ slug: string }> };

function parseRepuestos(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((x) => String(x).trim()).filter(Boolean);
  }
  if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.map((x) => String(x).trim()).filter(Boolean);
      }
    } catch {
      /* lista separada por | o saltos */
    }
    return raw
      .split(/[|\n]/)
      .map((x) => x.trim())
      .filter(Boolean);
  }
  return [];
}

export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantFlota(slug, "flota_servicios", "ver");
  if (guard.error) return guard.error;

  try {
    await asegurarSchemaFlota();
  } catch {
    /* ok */
  }

  const url = new URL(req.url);
  const vehiculoId = Number(url.searchParams.get("vehiculoId") ?? 0);
  const rows = await query<RowDataPacket[]>(
    `SELECT s.id, s.vehiculo_id, s.tipo, s.km_servicio, s.fecha_servicio, s.costo,
            s.descripcion, s.repuestos, s.observaciones, v.placa
     FROM flota_servicios s
     INNER JOIN flota_vehiculos v ON v.id = s.vehiculo_id
     WHERE s.empresa_id = ? ${vehiculoId ? "AND s.vehiculo_id = ?" : ""}
     ORDER BY s.fecha_servicio DESC
     LIMIT 200`,
    vehiculoId ? [guard.empresa.id, vehiculoId] : [guard.empresa.id],
  ).catch(async () =>
    query<RowDataPacket[]>(
      `SELECT s.id, s.vehiculo_id, s.tipo, s.km_servicio, s.fecha_servicio, s.costo,
              s.descripcion, v.placa
       FROM flota_servicios s
       INNER JOIN flota_vehiculos v ON v.id = s.vehiculo_id
       WHERE s.empresa_id = ? ${vehiculoId ? "AND s.vehiculo_id = ?" : ""}
       ORDER BY s.fecha_servicio DESC
       LIMIT 200`,
      vehiculoId ? [guard.empresa.id, vehiculoId] : [guard.empresa.id],
    ),
  );

  const ids = rows.map((r) => Number(r.id));
  const adjCount = new Map<number, number>();
  if (ids.length) {
    try {
      const adj = await query<RowDataPacket[]>(
        `SELECT servicio_id, COUNT(*) AS n FROM flota_servicio_adjuntos
         WHERE empresa_id = ? AND servicio_id IN (${ids.map(() => "?").join(",")})
         GROUP BY servicio_id`,
        [guard.empresa.id, ...ids],
      );
      for (const a of adj) adjCount.set(Number(a.servicio_id), Number(a.n));
    } catch {
      /* ok */
    }
  }

  return NextResponse.json({
    servicios: rows.map((r) => ({
      ...r,
      repuestos: parseRepuestos(r.repuestos ?? r.descripcion),
      adjuntos: adjCount.get(Number(r.id)) ?? 0,
    })),
  });
}

const schema = z.object({
  vehiculoId: z.number().int().positive(),
  tipo: z.string().min(1),
  kmServicio: z.number().int().nonnegative().optional(),
  fechaServicio: z.string().min(8),
  costo: z.number().nonnegative().default(0),
  descripcion: z.string().optional(),
  repuestos: z.array(z.string()).optional(),
  observaciones: z.string().optional(),
  sacarDeServicio: z.boolean().optional(),
});

export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantFlota(slug, "flota_servicios", "crear");
  if (guard.error) return guard.error;

  try {
    await asegurarSchemaFlota();
  } catch {
    /* ok */
  }

  const ctype = req.headers.get("content-type") ?? "";
  let d: z.infer<typeof schema>;
  const files: File[] = [];

  if (ctype.includes("multipart/form-data")) {
    const form = await req.formData();
    d = schema.parse({
      vehiculoId: Number(form.get("vehiculoId")),
      tipo: String(form.get("tipo") ?? "mantenimiento"),
      kmServicio: form.get("kmServicio")
        ? Number(form.get("kmServicio"))
        : undefined,
      fechaServicio: String(
        form.get("fechaServicio") ?? new Date().toISOString().slice(0, 10),
      ),
      costo: Number(form.get("costo") ?? 0),
      descripcion: form.get("descripcion")
        ? String(form.get("descripcion"))
        : undefined,
      repuestos: parseRepuestos(form.get("repuestos")),
      observaciones: form.get("observaciones")
        ? String(form.get("observaciones"))
        : undefined,
      sacarDeServicio: form.get("sacarDeServicio") === "1",
    });
    for (const [key, val] of form.entries()) {
      if (key.startsWith("file") && val instanceof File && val.size > 0) {
        files.push(val);
      }
    }
  } else {
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
    }
    d = parsed.data;
  }

  const veh = await query<RowDataPacket[]>(
    "SELECT id, placa, en_taller FROM flota_vehiculos WHERE id = ? AND empresa_id = ? LIMIT 1",
    [d.vehiculoId, guard.empresa.id],
  );
  if (!veh[0]) {
    return NextResponse.json({ error: "Vehículo no encontrado." }, { status: 404 });
  }

  // No registrar servicio si la unidad está en ruta (viaje abierto)
  const enRuta = await query<RowDataPacket[]>(
    `SELECT v.id, v.piloto_nombre FROM flota_viajes v
     WHERE v.empresa_id = ? AND v.vehiculo_id = ? AND v.estado = 'abierto' LIMIT 1`,
    [guard.empresa.id, d.vehiculoId],
  );
  if (enRuta[0]) {
    return NextResponse.json(
      {
        error: `${veh[0].placa} está en ruta con ${enRuta[0].piloto_nombre}. Cierra la llegada antes de registrar servicio / taller.`,
      },
      { status: 409 },
    );
  }

  const reps = (d.repuestos?.length ? d.repuestos : parseRepuestos(d.descripcion)).map(
    (x) => x.trim(),
  ).filter(Boolean);
  const desc = reps.length ? reps.join(" | ") : (d.descripcion?.trim() || null);
  const obs = d.observaciones?.trim() || null;

  let result;
  try {
    result = await execute(
      `INSERT INTO flota_servicios
        (empresa_id, vehiculo_id, tipo, km_servicio, fecha_servicio, costo,
         descripcion, repuestos, observaciones)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        guard.empresa.id,
        d.vehiculoId,
        d.tipo,
        d.kmServicio ?? null,
        d.fechaServicio,
        d.costo,
        desc,
        reps.length ? JSON.stringify(reps) : null,
        obs,
      ],
    );
  } catch {
    result = await execute(
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
        [desc, obs].filter(Boolean).join(" · ") || null,
      ],
    );
  }
  const servicioId = Number(result.insertId);

  if (d.sacarDeServicio !== false) {
    await execute(
      `UPDATE flota_vehiculos SET
        km_ultimo_servicio = COALESCE(?, km_ultimo_servicio),
        fecha_ultimo_servicio = ?,
        en_taller = 0,
        fecha_entrada_taller = NULL,
        motivo_taller = NULL,
        estado = 'Activo'
       WHERE id = ? AND empresa_id = ?`,
      [d.kmServicio ?? null, d.fechaServicio, d.vehiculoId, guard.empresa.id],
    ).catch(async () => {
      await execute(
        `UPDATE flota_vehiculos SET
          km_ultimo_servicio = COALESCE(?, km_ultimo_servicio),
          fecha_ultimo_servicio = ?,
          en_taller = 0,
          fecha_entrada_taller = NULL
         WHERE id = ? AND empresa_id = ?`,
        [d.kmServicio ?? null, d.fechaServicio, d.vehiculoId, guard.empresa.id],
      );
    });
  } else if (d.kmServicio != null) {
    await execute(
      `UPDATE flota_vehiculos SET
        km_ultimo_servicio = COALESCE(?, km_ultimo_servicio),
        fecha_ultimo_servicio = ?
       WHERE id = ? AND empresa_id = ?`,
      [d.kmServicio, d.fechaServicio, d.vehiculoId, guard.empresa.id],
    );
  }

  const subidos: string[] = [];
  for (const file of files) {
    try {
      const saved = await guardarUpload(
        guard.empresa.id,
        "flota",
        `svc${servicioId}`,
        file,
      );
      await execute(
        `INSERT INTO flota_servicio_adjuntos
          (empresa_id, servicio_id, ruta_relativa, nombre_original, mime, tamano, subido_por, creado_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          guard.empresa.id,
          servicioId,
          saved.relative,
          saved.original,
          contentTypeFor(saved.original),
          saved.size,
          guard.session.username,
          ahoraLocal(),
        ],
      );
      subidos.push(saved.original);
    } catch (err) {
      console.error("adjunto flota", err);
    }
  }

  return NextResponse.json({
    id: servicioId,
    mensaje: `Servicio de ${veh[0].placa} registrado.${
      reps.length ? ` ${reps.length} repuesto(s).` : ""
    }${subidos.length ? ` ${subidos.length} archivo(s) adjunto(s).` : ""}${
      d.sacarDeServicio !== false ? " Unidad fuera de taller / en servicio." : ""
    }`,
    adjuntos: subidos.length,
    repuestos: reps,
  });
}
