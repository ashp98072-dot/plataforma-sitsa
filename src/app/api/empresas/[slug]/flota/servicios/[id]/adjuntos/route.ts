import { readFileSync } from "fs";
import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { query } from "@/lib/db";
import { requireTenantFlota } from "@/lib/tenant";
import { absPathFromRelative, contentTypeFor } from "@/lib/uploads";

type Ctx = { params: Promise<{ slug: string; id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { slug, id: raw } = await ctx.params;
  const guard = await requireTenantFlota(slug, "flota_servicios", "ver");
  if (guard.error) return guard.error;

  const servicioId = Number(raw);
  if (!servicioId) {
    return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  }

  const rows = await query<RowDataPacket[]>(
    `SELECT id, nombre_original, mime, tamano, subido_por, creado_at, ruta_relativa
     FROM flota_servicio_adjuntos
     WHERE empresa_id = ? AND servicio_id = ?
     ORDER BY id DESC`,
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
    })),
  });
}

/** Descargar un adjunto: ?adjuntoId= */
export async function POST(req: Request, ctx: Ctx) {
  const { slug, id: raw } = await ctx.params;
  const guard = await requireTenantFlota(slug, "flota_servicios", "ver");
  if (guard.error) return guard.error;

  const servicioId = Number(raw);
  const body = await req.json().catch(() => ({}));
  const adjuntoId = Number(body?.adjuntoId ?? 0);
  if (!servicioId || !adjuntoId) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }

  const rows = await query<RowDataPacket[]>(
    `SELECT ruta_relativa, nombre_original, mime
     FROM flota_servicio_adjuntos
     WHERE id = ? AND servicio_id = ? AND empresa_id = ? LIMIT 1`,
    [adjuntoId, servicioId, guard.empresa.id],
  );
  if (!rows[0]) {
    return NextResponse.json({ error: "Adjunto no encontrado." }, { status: 404 });
  }

  const abs = absPathFromRelative(String(rows[0].ruta_relativa));
  const buf = readFileSync(abs);
  const name = String(rows[0].nombre_original);
  return new NextResponse(buf, {
    headers: {
      "Content-Type": String(rows[0].mime || contentTypeFor(name)),
      "Content-Disposition": `inline; filename="${name.replace(/"/g, "")}"`,
    },
  });
}
