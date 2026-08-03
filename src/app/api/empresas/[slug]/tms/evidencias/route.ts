import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { execute, query } from "@/lib/db";
import { requireTenantModulo } from "@/lib/tenant";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantModulo(slug, "tms");
  if (guard.error) return guard.error;

  const planId = Number(new URL(req.url).searchParams.get("planId") ?? 0);
  if (!planId) {
    return NextResponse.json({ error: "planId requerido." }, { status: 400 });
  }

  const rows = await query<RowDataPacket[]>(
    `SELECT id, plan_id, tipo, ruta_archivo, nombre_original, latitud, longitud, capturado_en, subido_por
     FROM tms_evidencias
     WHERE empresa_id = ? AND plan_id = ?
     ORDER BY capturado_en DESC`,
    [guard.empresa.id, planId],
  );
  return NextResponse.json({ evidencias: rows });
}

export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantModulo(slug, "tms", true);
  if (guard.error) return guard.error;

  const form = await req.formData();
  const planId = Number(form.get("planId") ?? 0);
  const tipo = String(form.get("tipo") ?? "Carga");
  const latitud = form.get("latitud") ? Number(form.get("latitud")) : null;
  const longitud = form.get("longitud") ? Number(form.get("longitud")) : null;
  const file = form.get("file");

  if (!planId || !(file instanceof File)) {
    return NextResponse.json(
      { error: "planId y archivo son requeridos." },
      { status: 400 },
    );
  }

  const plan = await query<RowDataPacket[]>(
    "SELECT id FROM tms_planes_viaje WHERE id = ? AND empresa_id = ? LIMIT 1",
    [planId, guard.empresa.id],
  );
  if (!plan[0]) {
    return NextResponse.json({ error: "Plan no encontrado." }, { status: 404 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const relDir = path.join("uploads", "tms", String(guard.empresa.id), String(planId));
  const absDir = path.join(process.cwd(), relDir);
  await mkdir(absDir, { recursive: true });
  const filename = `${Date.now()}_${safeName}`;
  await writeFile(path.join(absDir, filename), bytes);
  const ruta = path.join(relDir, filename).replace(/\\/g, "/");

  const result = await execute(
    `INSERT INTO tms_evidencias
      (empresa_id, plan_id, tipo, ruta_archivo, nombre_original, latitud, longitud, subido_por)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      guard.empresa.id,
      planId,
      tipo,
      ruta,
      file.name,
      latitud,
      longitud,
      guard.session.username,
    ],
  );

  return NextResponse.json({
    id: result.insertId,
    mensaje: "Evidencia registrada.",
    ruta,
  });
}
