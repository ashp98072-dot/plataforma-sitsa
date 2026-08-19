import { NextResponse } from "next/server";
import { requireTenantFlota } from "@/lib/tenant";
import { borrarUpload } from "@/lib/uploads";
import {
  actualizarDocumentoVehiculo,
  eliminarDocumentoVehiculo,
} from "@/lib/flota/vehiculo-documentos";

type Ctx = { params: Promise<{ slug: string; id: string; docId: string }> };

function parseId(v: string): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * PATCH /api/empresas/[slug]/flota/vehiculos/[id]/documentos/[docId]
 * Edita estado (Vigente/Inactivo), fecha de vencimiento, notas o título.
 * No reemplaza el archivo — para eso se sube uno nuevo (POST en la ruta
 * padre) y se elimina este si ya no aplica.
 */
export async function PATCH(req: Request, ctx: Ctx) {
  const { slug, id, docId } = await ctx.params;
  const guard = await requireTenantFlota(slug, "flota_vehiculos", "editar");
  if (guard.error) return guard.error;

  const vehiculoId = parseId(id);
  const documentoId = parseId(docId);
  if (!vehiculoId || !documentoId) {
    return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const patch: {
    estado?: "Vigente" | "Inactivo";
    fechaVencimiento?: string | null;
    notas?: string | null;
    titulo?: string | null;
  } = {};
  if (body.estado === "Vigente" || body.estado === "Inactivo") {
    patch.estado = body.estado;
  }
  if (body.fechaVencimiento !== undefined) {
    patch.fechaVencimiento = body.fechaVencimiento || null;
  }
  if (body.notas !== undefined) patch.notas = body.notas || null;
  if (body.titulo !== undefined) patch.titulo = body.titulo || null;

  const r = await actualizarDocumentoVehiculo(
    guard.empresa.id,
    vehiculoId,
    documentoId,
    patch,
  );
  if (!r.ok) {
    return NextResponse.json({ error: r.mensaje }, { status: 400 });
  }
  return NextResponse.json({ mensaje: r.mensaje });
}

/**
 * DELETE /api/empresas/[slug]/flota/vehiculos/[id]/documentos/[docId]
 * Borra el registro y, si tenía archivo, también el archivo en disco.
 */
export async function DELETE(_req: Request, ctx: Ctx) {
  const { slug, id, docId } = await ctx.params;
  const guard = await requireTenantFlota(slug, "flota_vehiculos", "editar");
  if (guard.error) return guard.error;

  const vehiculoId = parseId(id);
  const documentoId = parseId(docId);
  if (!vehiculoId || !documentoId) {
    return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  }

  const r = await eliminarDocumentoVehiculo(
    guard.empresa.id,
    vehiculoId,
    documentoId,
  );
  if (!r.ok) {
    return NextResponse.json({ error: r.mensaje }, { status: 400 });
  }
  if (r.rutaRelativaBorrada) {
    try {
      borrarUpload(r.rutaRelativaBorrada);
    } catch (e) {
      console.error("borrarUpload documento vehiculo", e);
    }
  }
  return NextResponse.json({ mensaje: r.mensaje });
}