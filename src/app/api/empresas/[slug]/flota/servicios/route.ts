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
  let guard = await requireTenantFlota(slug, "flota_servicios", "ver");
  if (guard.error) {
    guard = await requireTenantFlota(slug, "flota_compras", "ver");
  }
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
            s.descripcion, s.repuestos, s.observaciones,
            s.fecha_entrada_taller, s.fecha_salida_taller, s.dias_en_taller, v.placa
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
  fechaEntradaTaller: z.string().optional(),
  fechaSalidaTaller: z.string().optional(),
  sacarDeServicio: z.boolean().optional(),
});

function diasEntre(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const d1 = new Date(a.slice(0, 10) + "T12:00:00");
  const d2 = new Date(b.slice(0, 10) + "T12:00:00");
  if (Number.isNaN(d1.getTime()) || Number.isNaN(d2.getTime())) return null;
  const ms = d2.getTime() - d1.getTime();
  return Math.max(0, Math.round(ms / 86400000));
}

export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  let guard = await requireTenantFlota(slug, "flota_servicios", "crear");
  if (guard.error) {
    guard = await requireTenantFlota(slug, "flota_compras", "crear");
  }
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
        form.get("fechaServicio") ??
          form.get("fechaSalidaTaller") ??
          new Date().toISOString().slice(0, 10),
      ),
      costo: Number(form.get("costo") ?? 0),
      descripcion: form.get("descripcion")
        ? String(form.get("descripcion"))
        : undefined,
      repuestos: parseRepuestos(form.get("repuestos")),
      observaciones: form.get("observaciones")
        ? String(form.get("observaciones"))
        : undefined,
      fechaEntradaTaller: form.get("fechaEntradaTaller")
        ? String(form.get("fechaEntradaTaller"))
        : undefined,
      fechaSalidaTaller: form.get("fechaSalidaTaller")
        ? String(form.get("fechaSalidaTaller"))
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
    `SELECT id, placa, en_taller, fecha_entrada_taller
     FROM flota_vehiculos WHERE id = ? AND empresa_id = ? LIMIT 1`,
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

  // Normalizar tipo: servicio_mayor reinicia contador; reparacion no; compra = factura sin taller
  const tipoRaw = d.tipo.trim().toLowerCase();
  const esCompra = tipoRaw === "compra" || tipoRaw === "factura";
  const esMayor =
    tipoRaw === "servicio_mayor" ||
    tipoRaw === "mantenimiento" ||
    tipoRaw === "mayor";
  const esReparacion =
    tipoRaw === "reparacion" || tipoRaw === "reparación";
  if (!esMayor && !esReparacion && !esCompra) {
    return NextResponse.json(
      {
        error:
          "Tipo inválido. Usa Servicio mayor, Reparación o Compra (factura).",
      },
      { status: 400 },
    );
  }
  const tipo = esCompra
    ? "compra"
    : esMayor
      ? "servicio_mayor"
      : "reparacion";

  if (esMayor && (d.kmServicio == null || d.kmServicio < 0)) {
    return NextResponse.json(
      {
        error:
          "Servicio mayor: el km es obligatorio para reiniciar el contador del servicio.",
      },
      { status: 400 },
    );
  }

  const reps = (d.repuestos?.length ? d.repuestos : parseRepuestos(d.descripcion)).map(
    (x) => x.trim(),
  ).filter(Boolean);
  const desc = reps.length ? reps.join(" | ") : (d.descripcion?.trim() || null);
  const obs = d.observaciones?.trim() || null;
  const hoy = new Date().toISOString().slice(0, 10);
  const fechaEntrada = esCompra
    ? null
    : ((d.fechaEntradaTaller?.slice(0, 10) ||
        (veh[0].fecha_entrada_taller
          ? String(veh[0].fecha_entrada_taller).slice(0, 10)
          : null) ||
        null) as string | null);
  const fechaSalida = esCompra
    ? null
    : d.sacarDeServicio
      ? (d.fechaSalidaTaller?.slice(0, 10) || d.fechaServicio.slice(0, 10) || hoy)
      : (d.fechaSalidaTaller?.slice(0, 10) || null);
  if (fechaEntrada && fechaSalida && fechaSalida < fechaEntrada) {
    return NextResponse.json(
      { error: "La fecha de salida no puede ser anterior a la de entrada al taller." },
      { status: 400 },
    );
  }
  const dias = diasEntre(fechaEntrada, fechaSalida);
  const fechaServicio = esCompra
    ? d.fechaServicio.slice(0, 10) || hoy
    : fechaSalida || d.fechaServicio.slice(0, 10) || hoy;

  let result;
  try {
    result = await execute(
      `INSERT INTO flota_servicios
        (empresa_id, vehiculo_id, tipo, km_servicio, fecha_servicio, costo,
         descripcion, repuestos, observaciones,
         fecha_entrada_taller, fecha_salida_taller, dias_en_taller)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        guard.empresa.id,
        d.vehiculoId,
        tipo,
        d.kmServicio ?? null,
        fechaServicio,
        d.costo,
        desc,
        reps.length ? JSON.stringify(reps) : null,
        obs,
        fechaEntrada,
        fechaSalida,
        dias,
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
        tipo,
        d.kmServicio ?? null,
        fechaServicio,
        d.costo,
        [desc, obs, fechaEntrada ? `Ent:${fechaEntrada}` : null, fechaSalida ? `Sal:${fechaSalida}` : null]
          .filter(Boolean)
          .join(" · ") || null,
      ],
    );
  }
  const servicioId = Number(result.insertId);

  // Servicio mayor: SIEMPRE reinicia contador (km_ultimo_servicio = km actual)
  // Reparación: NO toca el contador de servicio
  if (esMayor) {
    const kmReset = Number(d.kmServicio);
    if (d.sacarDeServicio !== false) {
      await execute(
        `UPDATE flota_vehiculos SET
          km_ultimo_servicio = ?,
          fecha_ultimo_servicio = ?,
          km_actual = GREATEST(COALESCE(km_actual, 0), ?),
          en_taller = 0,
          fecha_entrada_taller = NULL,
          motivo_taller = NULL,
          estado = 'Activo'
         WHERE id = ? AND empresa_id = ?`,
        [kmReset, fechaServicio, kmReset, d.vehiculoId, guard.empresa.id],
      ).catch(async () => {
        await execute(
          `UPDATE flota_vehiculos SET
            km_ultimo_servicio = ?,
            fecha_ultimo_servicio = ?,
            en_taller = 0,
            fecha_entrada_taller = NULL
           WHERE id = ? AND empresa_id = ?`,
          [kmReset, fechaServicio, d.vehiculoId, guard.empresa.id],
        );
      });
    } else {
      await execute(
        `UPDATE flota_vehiculos SET
          km_ultimo_servicio = ?,
          fecha_ultimo_servicio = ?,
          km_actual = GREATEST(COALESCE(km_actual, 0), ?),
          en_taller = 1,
          fecha_entrada_taller = COALESCE(fecha_entrada_taller, ?),
          estado = 'En taller'
         WHERE id = ? AND empresa_id = ?`,
        [
          kmReset,
          fechaServicio,
          kmReset,
          fechaEntrada,
          d.vehiculoId,
          guard.empresa.id,
        ],
      ).catch(() => undefined);
    }
  } else if (!esCompra && d.sacarDeServicio !== false) {
    // Reparación: sale de taller sin reiniciar contador
    await execute(
      `UPDATE flota_vehiculos SET
        en_taller = 0,
        fecha_entrada_taller = NULL,
        motivo_taller = NULL,
        estado = 'Activo',
        km_actual = GREATEST(COALESCE(km_actual, 0), COALESCE(?, km_actual, 0))
       WHERE id = ? AND empresa_id = ?`,
      [d.kmServicio ?? null, d.vehiculoId, guard.empresa.id],
    ).catch(() => undefined);
  } else if (!esCompra && fechaEntrada) {
    await execute(
      `UPDATE flota_vehiculos SET
        en_taller = 1,
        fecha_entrada_taller = COALESCE(fecha_entrada_taller, ?),
        estado = 'En taller'
       WHERE id = ? AND empresa_id = ?`,
      [fechaEntrada, d.vehiculoId, guard.empresa.id],
    ).catch(() => undefined);
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

  const extraMayor = esMayor
    ? ` Contador de servicio reiniciado en ${Number(d.kmServicio).toLocaleString("es-GT")} km.`
    : " Contador de servicio sin cambios (reparación).";

  return NextResponse.json({
    id: servicioId,
    mensaje: `Servicio de ${veh[0].placa} registrado.${extraMayor}${
      reps.length ? ` ${reps.length} repuesto(s).` : ""
    }${subidos.length ? ` ${subidos.length} archivo(s) adjunto(s).` : ""}${
      d.sacarDeServicio !== false ? " Unidad fuera de taller / en servicio." : ""
    }`,
    adjuntos: subidos.length,
    repuestos: reps,
    reinicioContador: esMayor,
  });
}

const patchSchema = schema.extend({
  id: z.number().int().positive(),
});

/** Editar un servicio existente (+ adjuntos nuevos opcionales). */
export async function PATCH(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  let g = await requireTenantFlota(slug, "flota_servicios", "editar");
  if (g.error) g = await requireTenantFlota(slug, "flota_servicios", "crear");
  if (g.error) return g.error;

  try {
    await asegurarSchemaFlota();
  } catch {
    /* ok */
  }

  const ctype = req.headers.get("content-type") ?? "";
  let d: z.infer<typeof patchSchema>;
  const files: File[] = [];

  if (ctype.includes("multipart/form-data")) {
    const form = await req.formData();
    d = patchSchema.parse({
      id: Number(form.get("id")),
      vehiculoId: Number(form.get("vehiculoId")),
      tipo: String(form.get("tipo") ?? "servicio_mayor"),
      kmServicio: form.get("kmServicio")
        ? Number(form.get("kmServicio"))
        : undefined,
      fechaServicio: String(
        form.get("fechaServicio") ??
          form.get("fechaSalidaTaller") ??
          new Date().toISOString().slice(0, 10),
      ),
      costo: Number(form.get("costo") ?? 0),
      repuestos: parseRepuestos(form.get("repuestos")),
      observaciones: form.get("observaciones")
        ? String(form.get("observaciones"))
        : undefined,
      fechaEntradaTaller: form.get("fechaEntradaTaller")
        ? String(form.get("fechaEntradaTaller"))
        : undefined,
      fechaSalidaTaller: form.get("fechaSalidaTaller")
        ? String(form.get("fechaSalidaTaller"))
        : undefined,
      sacarDeServicio: form.get("sacarDeServicio") === "1",
    });
    for (const [key, val] of form.entries()) {
      if (key.startsWith("file") && val instanceof File && val.size > 0) {
        files.push(val);
      }
    }
  } else {
    const parsed = patchSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
    }
    d = parsed.data;
  }

  const cur = await query<RowDataPacket[]>(
    `SELECT s.*, v.placa FROM flota_servicios s
     INNER JOIN flota_vehiculos v ON v.id = s.vehiculo_id
     WHERE s.id = ? AND s.empresa_id = ? LIMIT 1`,
    [d.id, g.empresa.id],
  );
  if (!cur[0]) {
    return NextResponse.json({ error: "Servicio no encontrado." }, { status: 404 });
  }

  const tipoRaw = d.tipo.trim().toLowerCase();
  const esMayor =
    tipoRaw === "servicio_mayor" ||
    tipoRaw === "mantenimiento" ||
    tipoRaw === "mayor";
  const tipo = esMayor ? "servicio_mayor" : "reparacion";

  if (esMayor && (d.kmServicio == null || d.kmServicio < 0)) {
    return NextResponse.json(
      {
        error:
          "Servicio mayor: el km es obligatorio para reiniciar el contador del servicio.",
      },
      { status: 400 },
    );
  }

  const reps = (d.repuestos?.length
    ? d.repuestos
    : parseRepuestos(d.descripcion)
  )
    .map((x) => x.trim())
    .filter(Boolean);
  const desc = reps.length ? reps.join(" | ") : null;
  const obs = d.observaciones?.trim() || null;
  const fechaEntrada = d.fechaEntradaTaller?.slice(0, 10) || null;
  const fechaSalida =
    d.fechaSalidaTaller?.slice(0, 10) ||
    d.fechaServicio?.slice(0, 10) ||
    null;
  if (fechaEntrada && fechaSalida && fechaSalida < fechaEntrada) {
    return NextResponse.json(
      {
        error:
          "La fecha de salida no puede ser anterior a la de entrada al taller.",
      },
      { status: 400 },
    );
  }
  const dias = diasEntre(fechaEntrada, fechaSalida);
  const fechaServicio = fechaSalida || d.fechaServicio.slice(0, 10);

  try {
    await execute(
      `UPDATE flota_servicios SET
        vehiculo_id = ?, tipo = ?, km_servicio = ?, fecha_servicio = ?, costo = ?,
        descripcion = ?, repuestos = ?, observaciones = ?,
        fecha_entrada_taller = ?, fecha_salida_taller = ?, dias_en_taller = ?
       WHERE id = ? AND empresa_id = ?`,
      [
        d.vehiculoId,
        tipo,
        d.kmServicio ?? null,
        fechaServicio,
        d.costo,
        desc,
        reps.length ? JSON.stringify(reps) : null,
        obs,
        fechaEntrada,
        fechaSalida,
        dias,
        d.id,
        g.empresa.id,
      ],
    );
  } catch {
    await execute(
      `UPDATE flota_servicios SET
        vehiculo_id = ?, tipo = ?, km_servicio = ?, fecha_servicio = ?, costo = ?,
        descripcion = ?
       WHERE id = ? AND empresa_id = ?`,
      [
        d.vehiculoId,
        tipo,
        d.kmServicio ?? null,
        fechaServicio,
        d.costo,
        [desc, obs].filter(Boolean).join(" · ") || null,
        d.id,
        g.empresa.id,
      ],
    );
  }

  if (esMayor && d.kmServicio != null) {
    await execute(
      `UPDATE flota_vehiculos SET
        km_ultimo_servicio = ?,
        fecha_ultimo_servicio = ?,
        km_actual = GREATEST(COALESCE(km_actual, 0), ?)
       WHERE id = ? AND empresa_id = ?`,
      [
        d.kmServicio,
        fechaServicio,
        d.kmServicio,
        d.vehiculoId,
        g.empresa.id,
      ],
    ).catch(() => undefined);
  }

  const subidos: string[] = [];
  for (const file of files) {
    try {
      const saved = await guardarUpload(
        g.empresa.id,
        "flota",
        `svc${d.id}`,
        file,
      );
      await execute(
        `INSERT INTO flota_servicio_adjuntos
          (empresa_id, servicio_id, ruta_relativa, nombre_original, mime, tamano, subido_por, creado_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          g.empresa.id,
          d.id,
          saved.relative,
          saved.original,
          contentTypeFor(saved.original),
          saved.size,
          g.session.username,
          ahoraLocal(),
        ],
      );
      subidos.push(saved.original);
    } catch (err) {
      console.error("adjunto flota edit", err);
    }
  }

  return NextResponse.json({
    id: d.id,
    mensaje: `Servicio de ${cur[0].placa} actualizado.${
      esMayor
        ? ` Contador reiniciado en ${Number(d.kmServicio).toLocaleString("es-GT")} km.`
        : ""
    }${subidos.length ? ` ${subidos.length} archivo(s) nuevo(s).` : ""}`,
  });
}
