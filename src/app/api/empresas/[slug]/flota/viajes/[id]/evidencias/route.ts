import { readFileSync } from "fs";
import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2/promise";
import { getPool, query } from "@/lib/db";
import { requireTenantFlota, requireTenantFlotaAny } from "@/lib/tenant";
import {
  asegurarSchemaFlota,
  asegurarSchemaFlotaLectura,
} from "@/lib/flota/schema";
import { registrarAuditoria } from "@/lib/auditoria";
import {
  eliminarEvidenciaViaje,
  guardarEvidenciaViaje,
  listarEvidenciasViaje,
  type TipoEvidenciaViaje,
} from "@/lib/flota/viaje-evidencias";
import { bloquearParadaDelPlan } from "@/lib/tms/paradas";
import { absPathFromRelative, contentTypeFor } from "@/lib/uploads";

type Ctx = { params: Promise<{ slug: string; id: string }> };

const TIPOS: TipoEvidenciaViaje[] = [
  "tablero_salida",
  "salida",
  "tablero_llegada",
  "llegada",
  "producto",
];

export async function GET(req: Request, ctx: Ctx) {
  const { slug, id: raw } = await ctx.params;
  const guard = await requireTenantFlotaAny(
    slug,
    ["flota_piloto", "flota_reportes"],
    "ver",
  );
  if (guard.error) return guard.error;

  try {
    await asegurarSchemaFlotaLectura();
  } catch {
    /* ok */
  }

  const viajeId = Number(raw);
  if (!viajeId) {
    return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  }

  const adjuntoId = Number(new URL(req.url).searchParams.get("adjuntoId") ?? 0);

  if (adjuntoId) {
    const rows = await query<RowDataPacket[]>(
      `SELECT ruta_relativa, nombre_original, mime
       FROM flota_viaje_evidencias
       WHERE id = ? AND viaje_id = ? AND empresa_id = ? LIMIT 1`,
      [adjuntoId, viajeId, guard.empresa.id],
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

  const viaje = await query<RowDataPacket[]>(
    `SELECT id FROM flota_viajes WHERE id = ? AND empresa_id = ? LIMIT 1`,
    [viajeId, guard.empresa.id],
  );
  if (!viaje[0]) {
    return NextResponse.json({ error: "Viaje no encontrado." }, { status: 404 });
  }

  const rows = await listarEvidenciasViaje(guard.empresa.id, viajeId);
  return NextResponse.json({
    evidencias: rows.map((r) => ({
      id: Number(r.id),
      tipo: String(r.tipo),
      nombre: String(r.nombre_original),
      latitud: r.latitud != null ? Number(r.latitud) : null,
      longitud: r.longitud != null ? Number(r.longitud) : null,
      capturadoEn: r.capturado_en,
      url: `/api/empresas/${slug}/flota/viajes/${viajeId}/evidencias?adjuntoId=${r.id}`,
    })),
  });
}

export async function POST(req: Request, ctx: Ctx) {
  const { slug, id: raw } = await ctx.params;
  const guard = await requireTenantFlota(slug, "flota_piloto", "crear");
  if (guard.error) return guard.error;

  try {
    await asegurarSchemaFlota();
  } catch {
    /* ok */
  }

  const viajeId = Number(raw);
  if (!viajeId) {
    return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  }

  const viaje = await query<RowDataPacket[]>(
    `SELECT id, plan_id, estado FROM flota_viajes
     WHERE id = ? AND empresa_id = ? LIMIT 1`,
    [viajeId, guard.empresa.id],
  );
  if (!viaje[0]) {
    return NextResponse.json({ error: "Viaje no encontrado." }, { status: 404 });
  }

  const form = await req.formData();
  const tipoRaw = String(form.get("tipo") ?? "salida");
  const tipo = TIPOS.includes(tipoRaw as TipoEvidenciaViaje)
    ? (tipoRaw as TipoEvidenciaViaje)
    : null;
  if (!tipo) {
    return NextResponse.json({ error: "Tipo de evidencia inválido." }, { status: 400 });
  }

  const latitud = form.get("latitud") ? Number(form.get("latitud")) : null;
  const longitud = form.get("longitud") ? Number(form.get("longitud")) : null;
  const capturadoEn = form.get("capturadoEn")
    ? String(form.get("capturadoEn"))
    : null;
  const paradaId = form.get("paradaId")
    ? Number(form.get("paradaId"))
    : null;

  const files: { name: string; size: number; type?: string; arrayBuffer: () => Promise<ArrayBuffer> }[] = [];
  for (const [key, val] of form.entries()) {
    if (key !== "file" && key !== "files") continue;
    // En Node/Next, a veces no es instanceof File sino Blob
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
  if (!files.length) {
    return NextResponse.json(
      {
        error:
          "No se recibió la foto. Prueba otra vez (JPG/PNG) o usa la cámara del celular.",
      },
      { status: 400 },
    );
  }

  const planId = viaje[0].plan_id ? Number(viaje[0].plan_id) : null;
  if (tipo === "producto" && (!planId || !paradaId)) {
    return NextResponse.json(
      { error: "Para evidencia de producto indica la parada del plan." },
      { status: 400 },
    );
  }
  // CORRECCIÓN PR #80: cualquier paradaId (no solo tipo "producto") exige
  // un plan asociado — antes se pasaba crudo a guardarEvidenciaViaje sin
  // comprobar siquiera que el viaje tuviera plan.
  if (paradaId && !planId) {
    return NextResponse.json(
      {
        error:
          "Este viaje no tiene un plan asociado; no se puede asociar evidencia a una parada.",
      },
      { status: 400 },
    );
  }

  const syncTmsTipo =
    tipo === "producto"
      ? ("Producto" as const)
      : tipo === "tablero_salida" || tipo === "salida"
        ? ("Carga" as const)
        : tipo === "tablero_llegada" || tipo === "llegada"
          ? ("Descarga" as const)
          : null;

  // CORRECCIÓN PR #80 (integridad concurrente evidencia ↔ parada): si
  // viene paradaId, se BLOQUEA (SELECT ... FOR UPDATE, vía
  // bloquearParadaDelPlan) esa fila de tms_plan_paradas ANTES de
  // insertar evidencia — validando de paso que existe, que pertenece a
  // ESTE plan y que ese plan pertenece a esta empresa. El INSERT se hace
  // con la MISMA conexión/transacción que adquirió el lock
  // (guardarEvidenciaViaje recibe `conn`). Es el mismo lock que
  // guardarParadasPlan adquiere antes de decidir un DELETE de esa parada
  // (ver src/lib/tms/paradas.ts): quien llegue primero serializa al
  // otro, así ninguno puede dejar una evidencia huérfana. Sin paradaId
  // no hay nada que bloquear — la transacción solo envuelve el/los
  // INSERT sin cambiar ningún comportamiento observable.
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();

    if (paradaId) {
      const existe = await bloquearParadaDelPlan(
        conn,
        guard.empresa.id,
        planId as number,
        paradaId,
      );
      if (!existe) {
        await conn.rollback();
        return NextResponse.json(
          { error: "La parada no pertenece a este viaje." },
          { status: 400 },
        );
      }
    }

    const ids: number[] = [];
    for (const file of files) {
      const id = await guardarEvidenciaViaje({
        empresaId: guard.empresa.id,
        viajeId,
        tipo,
        file,
        latitud: Number.isFinite(latitud as number) ? latitud : null,
        longitud: Number.isFinite(longitud as number) ? longitud : null,
        capturadoEn,
        username: guard.session.username,
        planId,
        paradaId: paradaId || null,
        syncTmsTipo,
        conn,
      });
      ids.push(id);
    }

    await conn.commit();

    return NextResponse.json({
      ids,
      mensaje: `${ids.length} evidencia(s) guardada(s).`,
    });
  } catch (e) {
    await conn.rollback();
    console.error("POST flota/viajes/evidencias transacción", e);
    return NextResponse.json(
      { error: "No se pudo guardar la evidencia. Intenta de nuevo." },
      { status: 500 },
    );
  } finally {
    conn.release();
  }
}

/** Solo Admin puede eliminar evidencias de viaje. */
export async function DELETE(req: Request, ctx: Ctx) {
  const { slug, id: raw } = await ctx.params;
  const guard = await requireTenantFlotaAny(
    slug,
    ["flota_reportes", "flota_piloto"],
    "ver",
  );
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

  const viajeId = Number(raw);
  const adjuntoId = Number(new URL(req.url).searchParams.get("adjuntoId") ?? 0);
  if (!viajeId || !adjuntoId) {
    return NextResponse.json(
      { error: "viaje e adjuntoId son requeridos." },
      { status: 400 },
    );
  }

  const result = await eliminarEvidenciaViaje(
    guard.empresa.id,
    viajeId,
    adjuntoId,
  );
  if (!result.ok) {
    return NextResponse.json({ error: result.mensaje }, { status: 404 });
  }
  await registrarAuditoria({
    empresaId: guard.empresa.id,
    usuario: guard.session.username,
    accion: "eliminar_evidencia",
    modulo: "tms",
    detalle: `Evidencia flota #${adjuntoId} eliminada del viaje #${viajeId}`,
  });
  return NextResponse.json({ mensaje: result.mensaje });
}
