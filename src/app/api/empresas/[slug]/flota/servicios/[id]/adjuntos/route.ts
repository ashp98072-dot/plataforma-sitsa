import { readFileSync } from "fs";
import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { execute, query } from "@/lib/db";
import { requireTenantFlota } from "@/lib/tenant";
import {
  asegurarSchemaFlota,
  asegurarSchemaFlotaLectura,
} from "@/lib/flota/schema";
import { ahoraLocal } from "@/lib/rrhh/dates";
import {
  absPathFromRelative,
  contentTypeFor,
  guardarUpload,
} from "@/lib/uploads";

type Ctx = { params: Promise<{ slug: string; id: string }> };

async function guardServiciosOCompras(
  slug: string,
  accion: "ver" | "crear",
) {
  let guard = await requireTenantFlota(slug, "flota_servicios", accion);
  if (guard.error) {
    guard = await requireTenantFlota(slug, "flota_compras", accion);
  }
  return guard;
}

export async function GET(req: Request, ctx: Ctx) {
  const { slug, id: raw } = await ctx.params;
  const guard = await guardServiciosOCompras(slug, "ver");
  if (guard.error) return guard.error;

  const servicioId = Number(raw);
  if (!servicioId) {
    return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  }

  const adjuntoId = Number(new URL(req.url).searchParams.get("adjuntoId") ?? 0);

  if (adjuntoId) {
    const rows = await query<RowDataPacket[]>(
      `SELECT ruta_relativa, nombre_original, mime
       FROM flota_servicio_adjuntos
       WHERE id = ? AND servicio_id = ? AND empresa_id = ? LIMIT 1`,
      [adjuntoId, servicioId, guard.empresa.id],
    );
    if (!rows[0]) {
      return NextResponse.json(
        { error: "Adjunto no encontrado." },
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
    `SELECT id, nombre_original, mime, tamano, subido_por, creado_at
     FROM flota_servicio_adjuntos
     WHERE empresa_id = ? AND servicio_id = ?
     ORDER BY id ASC`,
    [guard.empresa.id, servicioId],
  );
  return NextResponse.json({
    adjuntos: rows.map((r) => ({
      id: Number(r.id),
      nombre: String(r.nombre_original),
      mime: String(r.mime ?? ""),
      tamano: Number(r.tamano ?? 0),
      subidoPor: String(r.subido_por ?? ""),
      creadoAt: r.creado_at,
      url: `/api/empresas/${slug}/flota/servicios/${servicioId}/adjuntos?adjuntoId=${r.id}`,
    })),
  });
}

/** Adjuntar factura(s) a un servicio / compra existente. */
export async function POST(req: Request, ctx: Ctx) {
  const { slug, id: raw } = await ctx.params;
  const guard = await guardServiciosOCompras(slug, "crear");
  if (guard.error) return guard.error;

  await asegurarSchemaFlota().catch(() => undefined);

  const servicioId = Number(raw);
  if (!servicioId) {
    return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  }

  const existe = await query<RowDataPacket[]>(
    `SELECT id, vehiculo_id FROM flota_servicios
     WHERE id = ? AND empresa_id = ? LIMIT 1`,
    [servicioId, guard.empresa.id],
  );
  if (!existe[0]) {
    return NextResponse.json(
      { error: "Servicio / compra no encontrado." },
      { status: 404 },
    );
  }

  const form = await req.formData();
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (!files.length) {
    return NextResponse.json(
      { error: "Adjunta al menos una factura (PDF o imagen)." },
      { status: 400 },
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
    } catch (e) {
      console.error("upload factura", e);
    }
  }

  if (!subidos.length) {
    return NextResponse.json(
      { error: "No se pudo guardar ningún archivo." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    mensaje: `${subidos.length} factura(s) adjuntada(s) al vehículo/servicio.`,
    adjuntos: subidos.length,
    vehiculoId: Number(existe[0].vehiculo_id),
  });
}
