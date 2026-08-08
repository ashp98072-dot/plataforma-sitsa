import { readFileSync } from "fs";
import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { query } from "@/lib/db";
import { requireTenantFlotaAny } from "@/lib/tenant";
import {
  asegurarSchemaFlota,
  asegurarSchemaFlotaLectura,
} from "@/lib/flota/schema";
import {
  guardarEvidenciaLectura,
  listarEvidenciasLectura,
  type TipoEvidenciaLectura,
} from "@/lib/flota/lectura-evidencias";
import { listarEvidenciasViaje } from "@/lib/flota/viaje-evidencias";
import { absPathFromRelative, contentTypeFor } from "@/lib/uploads";

type Ctx = { params: Promise<{ slug: string; id: string }> };

const TIPOS: TipoEvidenciaLectura[] = ["tablero", "evidencia"];

export async function GET(req: Request, ctx: Ctx) {
  const { slug, id: raw } = await ctx.params;
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

  const lecturaId = Number(raw);
  if (!lecturaId) {
    return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  }

  const url = new URL(req.url);
  const adjuntoId = Number(url.searchParams.get("adjuntoId") ?? 0);
  const origen = String(url.searchParams.get("origen") ?? "lectura");

  if (adjuntoId) {
    if (origen === "viaje") {
      const rows = await query<RowDataPacket[]>(
        `SELECT ruta_relativa, nombre_original, mime
         FROM flota_viaje_evidencias
         WHERE id = ? AND empresa_id = ? LIMIT 1`,
        [adjuntoId, guard.empresa.id],
      );
      if (!rows[0]) {
        return NextResponse.json(
          { error: "Evidencia no encontrada." },
          { status: 404 },
        );
      }
      try {
        const abs = absPathFromRelative(String(rows[0].ruta_relativa));
        const buf = readFileSync(abs);
        const name = String(rows[0].nombre_original);
        return new NextResponse(buf, {
          headers: {
            "Content-Type": String(rows[0].mime || contentTypeFor(name)),
            "Content-Disposition": `inline; filename="${name.replace(/"/g, "")}"`,
            "Cache-Control": "private, max-age=60",
          },
        });
      } catch {
        return NextResponse.json(
          { error: "Archivo no encontrado en disco." },
          { status: 404 },
        );
      }
    }

    const rows = await query<RowDataPacket[]>(
      `SELECT ruta_relativa, nombre_original, mime
       FROM flota_lectura_evidencias
       WHERE id = ? AND lectura_id = ? AND empresa_id = ? LIMIT 1`,
      [adjuntoId, lecturaId, guard.empresa.id],
    );
    if (!rows[0]) {
      return NextResponse.json(
        { error: "Evidencia no encontrada." },
        { status: 404 },
      );
    }
    try {
      const abs = absPathFromRelative(String(rows[0].ruta_relativa));
      const buf = readFileSync(abs);
      const name = String(rows[0].nombre_original);
      return new NextResponse(buf, {
        headers: {
          "Content-Type": String(rows[0].mime || contentTypeFor(name)),
          "Content-Disposition": `inline; filename="${name.replace(/"/g, "")}"`,
          "Cache-Control": "private, max-age=60",
        },
      });
    } catch {
      return NextResponse.json(
        { error: "Archivo no encontrado en disco." },
        { status: 404 },
      );
    }
  }

  const lec = await query<RowDataPacket[]>(
    `SELECT id, viaje_id, vehiculo_id, km, fecha_lectura, nota
     FROM flota_lecturas
     WHERE id = ? AND empresa_id = ? LIMIT 1`,
    [lecturaId, guard.empresa.id],
  );
  if (!lec[0]) {
    return NextResponse.json({ error: "Lectura no encontrada." }, { status: 404 });
  }

  const propias = await listarEvidenciasLectura(guard.empresa.id, lecturaId);
  const evidencias: {
    id: number;
    origen: "lectura" | "viaje";
    tipo: string;
    nombre: string;
    latitud: number | null;
    longitud: number | null;
    capturadoEn: unknown;
    url: string;
  }[] = propias.map((r) => ({
    id: Number(r.id),
    origen: "lectura" as const,
    tipo: String(r.tipo),
    nombre: String(r.nombre_original),
    latitud: r.latitud != null ? Number(r.latitud) : null,
    longitud: r.longitud != null ? Number(r.longitud) : null,
    capturadoEn: r.capturado_en,
    url: `/api/empresas/${slug}/flota/lecturas/${lecturaId}/evidencias?adjuntoId=${r.id}&origen=lectura`,
  }));

  let viajeId = lec[0].viaje_id != null ? Number(lec[0].viaje_id) : null;
  // Lecturas antiguas de viaje sin viaje_id: intentar enlazar por unidad/km/fecha
  if (!viajeId) {
    const nota = String(lec[0].nota ?? "").toLowerCase();
    if (nota.includes("viaje")) {
      const fecha = String(lec[0].fecha_lectura).slice(0, 10);
      const km = Number(lec[0].km);
      const match = await query<RowDataPacket[]>(
        `SELECT id FROM flota_viajes
         WHERE empresa_id = ? AND vehiculo_id = ?
           AND DATE(hora_salida) = ?
           AND (km_salida = ? OR km_llegada = ?)
         ORDER BY id DESC LIMIT 1`,
        [guard.empresa.id, Number(lec[0].vehiculo_id), fecha, km, km],
      ).catch(() => [] as RowDataPacket[]);
      if (match[0]) viajeId = Number(match[0].id);
    }
  }
  if (viajeId) {
    const deViaje = await listarEvidenciasViaje(guard.empresa.id, viajeId).catch(
      () => [] as RowDataPacket[],
    );
    for (const r of deViaje) {
      evidencias.push({
        id: Number(r.id),
        origen: "viaje" as const,
        tipo: String(r.tipo),
        nombre: String(r.nombre_original),
        latitud: r.latitud != null ? Number(r.latitud) : null,
        longitud: r.longitud != null ? Number(r.longitud) : null,
        capturadoEn: r.capturado_en,
        url: `/api/empresas/${slug}/flota/lecturas/${lecturaId}/evidencias?adjuntoId=${r.id}&origen=viaje`,
      });
    }
  }

  return NextResponse.json({ evidencias, viajeId });
}

export async function POST(req: Request, ctx: Ctx) {
  const { slug, id: raw } = await ctx.params;
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

  const lecturaId = Number(raw);
  if (!lecturaId) {
    return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  }

  const lec = await query<RowDataPacket[]>(
    `SELECT id FROM flota_lecturas WHERE id = ? AND empresa_id = ? LIMIT 1`,
    [lecturaId, guard.empresa.id],
  );
  if (!lec[0]) {
    return NextResponse.json({ error: "Lectura no encontrada." }, { status: 404 });
  }

  const form = await req.formData();
  const tipoRaw = String(form.get("tipo") ?? "tablero");
  const tipo = TIPOS.includes(tipoRaw as TipoEvidenciaLectura)
    ? (tipoRaw as TipoEvidenciaLectura)
    : "tablero";
  const latitud = form.get("latitud") ? Number(form.get("latitud")) : null;
  const longitud = form.get("longitud") ? Number(form.get("longitud")) : null;
  const capturadoEn = form.get("capturadoEn")
    ? String(form.get("capturadoEn"))
    : null;

  const files: File[] = [];
  for (const [key, val] of form.entries()) {
    if (
      val instanceof File &&
      val.size > 0 &&
      (key === "file" || key === "files")
    ) {
      files.push(val);
    }
  }
  if (!files.length) {
    return NextResponse.json({ error: "Adjunta al menos una foto." }, { status: 400 });
  }

  const ids: number[] = [];
  for (const file of files) {
    const id = await guardarEvidenciaLectura({
      empresaId: guard.empresa.id,
      lecturaId,
      tipo,
      file,
      latitud: Number.isFinite(latitud as number) ? latitud : null,
      longitud: Number.isFinite(longitud as number) ? longitud : null,
      capturadoEn,
      username: guard.session.username,
    });
    ids.push(id);
  }

  return NextResponse.json({
    ids,
    mensaje: `${ids.length} evidencia(s) guardada(s).`,
  });
}
