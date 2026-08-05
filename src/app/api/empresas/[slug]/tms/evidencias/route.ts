import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { execute, query } from "@/lib/db";
import { requireTenantModulo, requireTenantFlotaAny } from "@/lib/tenant";
import { asegurarSchemaFlota } from "@/lib/flota/schema";
import { validarParadaDelPlan } from "@/lib/tms/paradas";
import { contentTypeFor, guardarUpload } from "@/lib/uploads";
import { ahoraLocal } from "@/lib/rrhh/dates";
import { readFileSync } from "fs";
import { absPathFromRelative } from "@/lib/uploads";
import { registrarAuditoria } from "@/lib/auditoria";
import { eliminarEvidenciaTms } from "@/lib/flota/viaje-evidencias";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const tmsGuard = await requireTenantModulo(slug, "tms");
  const guard = tmsGuard.error
    ? await requireTenantFlotaAny(
        slug,
        ["flota_piloto", "flota_reportes"],
        "ver",
      )
    : tmsGuard;
  if (guard.error) return guard.error;

  try {
    await asegurarSchemaFlota();
  } catch {
    /* ok */
  }

  const url = new URL(req.url);
  const planId = Number(url.searchParams.get("planId") ?? 0);
  const adjuntoId = Number(url.searchParams.get("adjuntoId") ?? 0);

  if (adjuntoId) {
    const rows = await query<RowDataPacket[]>(
      `SELECT ruta_archivo, nombre_original
       FROM tms_evidencias
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
      const abs = absPathFromRelative(String(rows[0].ruta_archivo));
      const buf = readFileSync(abs);
      const name = String(rows[0].nombre_original);
      return new NextResponse(buf, {
        headers: {
          "Content-Type": contentTypeFor(name),
          "Content-Disposition": `inline; filename="${name.replace(/"/g, "")}"`,
          "Cache-Control": "private, max-age=60",
        },
      });
    } catch {
      // Fallback: rutas antiguas bajo process.cwd()/uploads
      try {
        const { join } = await import("path");
        const abs = join(process.cwd(), String(rows[0].ruta_archivo));
        const buf = readFileSync(abs);
        const name = String(rows[0].nombre_original);
        return new NextResponse(buf, {
          headers: {
            "Content-Type": contentTypeFor(name),
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
  }

  if (!planId) {
    return NextResponse.json({ error: "planId requerido." }, { status: 400 });
  }

  const rows = await query<RowDataPacket[]>(
    `SELECT e.id, e.plan_id, e.tipo, e.ruta_archivo, e.nombre_original,
            e.latitud, e.longitud, e.capturado_en, e.subido_por, e.parada_id,
            pp.lugar_nombre AS parada_nombre, pp.orden AS parada_orden, pp.tipo AS parada_tipo
     FROM tms_evidencias e
     LEFT JOIN tms_plan_paradas pp ON pp.id = e.parada_id
     WHERE e.empresa_id = ? AND e.plan_id = ?
     ORDER BY COALESCE(pp.orden, 99), e.id DESC`,
    [guard.empresa.id, planId],
  ).catch(async () =>
    query<RowDataPacket[]>(
      `SELECT id, plan_id, tipo, ruta_archivo, nombre_original, latitud, longitud,
              capturado_en, subido_por
       FROM tms_evidencias
       WHERE empresa_id = ? AND plan_id = ?
       ORDER BY capturado_en DESC`,
      [guard.empresa.id, planId],
    ),
  );

  return NextResponse.json({
    evidencias: rows.map((r) => ({
      id: Number(r.id),
      plan_id: Number(r.plan_id),
      tipo: String(r.tipo),
      parada_id: r.parada_id != null ? Number(r.parada_id) : null,
      parada_nombre: r.parada_nombre ? String(r.parada_nombre) : null,
      parada_orden: r.parada_orden != null ? Number(r.parada_orden) : null,
      parada_tipo: r.parada_tipo ? String(r.parada_tipo) : null,
      nombre: String(r.nombre_original),
      latitud: r.latitud != null ? Number(r.latitud) : null,
      longitud: r.longitud != null ? Number(r.longitud) : null,
      capturadoEn: r.capturado_en,
      subidoPor: r.subido_por,
      url: `/api/empresas/${slug}/tms/evidencias?adjuntoId=${r.id}`,
    })),
  });
}

export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  // Ops o piloto pueden subir evidencia de producto
  let guard = await requireTenantModulo(slug, "tms", true);
  if (guard.error) {
    guard = await requireTenantFlotaAny(slug, ["flota_piloto"], "crear");
  }
  if (guard.error) return guard.error;

  try {
    await asegurarSchemaFlota();
  } catch {
    /* ok */
  }

  const form = await req.formData();
  const planId = Number(form.get("planId") ?? 0);
  const paradaId = form.get("paradaId")
    ? Number(form.get("paradaId"))
    : null;
  const tipo = String(form.get("tipo") ?? (paradaId ? "Producto" : "Carga"));
  const latitud = form.get("latitud") ? Number(form.get("latitud")) : null;
  const longitud = form.get("longitud") ? Number(form.get("longitud")) : null;
  const capturadoEn = form.get("capturadoEn")
    ? String(form.get("capturadoEn"))
    : ahoraLocal();

  const files: {
    name: string;
    size: number;
    type?: string;
    arrayBuffer: () => Promise<ArrayBuffer>;
  }[] = [];
  for (const [key, val] of form.entries()) {
    if (key !== "file" && key !== "files") continue;
    if (
      val &&
      typeof val === "object" &&
      "arrayBuffer" in val &&
      typeof (val as Blob).arrayBuffer === "function" &&
      typeof (val as Blob).size === "number" &&
      (val as Blob).size > 0
    ) {
      const blob = val as Blob & { name?: string };
      files.push({
        name: blob.name || `foto_${Date.now()}.jpg`,
        size: blob.size,
        type: blob.type,
        arrayBuffer: () => blob.arrayBuffer(),
      });
    }
  }
  if (!planId || !files.length) {
    return NextResponse.json(
      {
        error:
          "planId y archivo son requeridos. Si ya elegiste foto, prueba JPG/PNG.",
      },
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

  let paradaOk: number | null = null;
  if (paradaId) {
    const p = await validarParadaDelPlan(guard.empresa.id, planId, paradaId);
    if (!p) {
      return NextResponse.json(
        { error: "Parada no válida para este plan." },
        { status: 400 },
      );
    }
    paradaOk = p.id;
  }

  const ids: number[] = [];
  for (const file of files) {
    const saved = await guardarUpload(
      guard.empresa.id,
      "evidencias",
      `plan_${planId}${paradaOk ? `_p${paradaOk}` : ""}`,
      file,
    );

    let result;
    try {
      result = await execute(
        `INSERT INTO tms_evidencias
          (empresa_id, plan_id, tipo, ruta_archivo, nombre_original, latitud, longitud,
           subido_por, parada_id, capturado_en)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          guard.empresa.id,
          planId,
          tipo,
          saved.relative,
          saved.original,
          Number.isFinite(latitud as number) ? latitud : null,
          Number.isFinite(longitud as number) ? longitud : null,
          guard.session.username,
          paradaOk,
          capturadoEn,
        ],
      );
    } catch {
      result = await execute(
        `INSERT INTO tms_evidencias
          (empresa_id, plan_id, tipo, ruta_archivo, nombre_original, latitud, longitud, subido_por)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          guard.empresa.id,
          planId,
          tipo,
          saved.relative,
          saved.original,
          Number.isFinite(latitud as number) ? latitud : null,
          Number.isFinite(longitud as number) ? longitud : null,
          guard.session.username,
        ],
      );
    }
    ids.push(Number(result.insertId));
  }

  return NextResponse.json({
    ids,
    mensaje: `${ids.length} evidencia(s) registrada(s).`,
  });
}

/** Solo Admin puede eliminar evidencias TMS. */
export async function DELETE(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const tmsGuard = await requireTenantModulo(slug, "tms");
  const guard = tmsGuard.error
    ? await requireTenantFlotaAny(
        slug,
        ["flota_piloto", "flota_reportes"],
        "ver",
      )
    : tmsGuard;
  if (guard.error) return guard.error;

  if (guard.session.rol !== "Admin") {
    return NextResponse.json(
      {
        error:
          "Solo un administrador puede eliminar evidencias. Solicita el borrado a un Admin.",
        code: "SOLO_ADMIN",
      },
      { status: 403 },
    );
  }

  try {
    await asegurarSchemaFlota();
  } catch {
    /* ok */
  }

  const adjuntoId = Number(new URL(req.url).searchParams.get("adjuntoId") ?? 0);
  if (!adjuntoId) {
    return NextResponse.json(
      { error: "adjuntoId requerido." },
      { status: 400 },
    );
  }

  const result = await eliminarEvidenciaTms(guard.empresa.id, adjuntoId);
  if (!result.ok) {
    return NextResponse.json({ error: result.mensaje }, { status: 404 });
  }
  await registrarAuditoria({
    empresaId: guard.empresa.id,
    usuario: guard.session.username,
    accion: "eliminar_evidencia",
    modulo: "tms",
    detalle: `Evidencia TMS #${adjuntoId} eliminada`,
  });
  return NextResponse.json({ mensaje: result.mensaje });
}
