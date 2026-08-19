import { readFileSync } from "fs";
import { NextResponse } from "next/server";
import { requireTenantFlota } from "@/lib/tenant";
import { asegurarSchemaFlota } from "@/lib/flota/schema";
import { ahoraLocal } from "@/lib/rrhh/dates";
import {
  absPathFromRelative,
  contentTypeFor,
  guardarUpload,
} from "@/lib/uploads";
import {
  crearDocumentoVehiculo,
  listarDocumentosVehiculo,
  obtenerArchivoDocumento,
  type TipoDocumentoVehiculo,
} from "@/lib/flota/vehiculo-documentos";

type Ctx = { params: Promise<{ slug: string; id: string }> };

const TIPOS_VALIDOS = new Set<TipoDocumentoVehiculo>([
  "TarjetaCirculacion",
  "PolizaSeguro",
  "TituloPropiedad",
  "PermisoLinea",
  "Otro",
]);

/**
 * GET /api/empresas/[slug]/flota/vehiculos/[id]/documentos
 * ?documentoId=123 -> descarga ese archivo puntual.
 * Sin ese parámetro -> lista todos los documentos del vehículo (metadata).
 */
export async function GET(req: Request, ctx: Ctx) {
  const { slug, id: raw } = await ctx.params;
  const guard = await requireTenantFlota(slug, "flota_vehiculos", "ver");
  if (guard.error) return guard.error;

  const vehiculoId = Number(raw);
  if (!vehiculoId) {
    return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  }

  const documentoId = Number(
    new URL(req.url).searchParams.get("documentoId") ?? 0,
  );

  if (documentoId) {
    const archivo = await obtenerArchivoDocumento(
      guard.empresa.id,
      vehiculoId,
      documentoId,
    );
    if (!archivo) {
      return NextResponse.json(
        { error: "Archivo no encontrado." },
        { status: 404 },
      );
    }
    try {
      const abs = absPathFromRelative(archivo.rutaRelativa);
      const buf = readFileSync(abs);
      const name = archivo.nombreOriginal;
      return new NextResponse(buf, {
        headers: {
          "Content-Type": archivo.mime || contentTypeFor(name),
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

  const documentos = await listarDocumentosVehiculo(guard.empresa.id, vehiculoId);
  return NextResponse.json({
    documentos: documentos.map((d) => ({
      ...d,
      url: d.archivo
        ? `/api/empresas/${slug}/flota/vehiculos/${vehiculoId}/documentos?documentoId=${d.id}`
        : null,
    })),
  });
}

/**
 * POST /api/empresas/[slug]/flota/vehiculos/[id]/documentos
 * multipart/form-data. Campos: tipo (requerido), titulo (si tipo=Otro),
 * estado, fechaVencimiento, notas — todos opcionales salvo tipo.
 * "file" es opcional: se puede registrar solo un comentario sin adjuntar
 * ningún archivo (p.ej. "se desactivó la póliza porque…").
 */
export async function POST(req: Request, ctx: Ctx) {
  const { slug, id: raw } = await ctx.params;
  const guard = await requireTenantFlota(slug, "flota_vehiculos", "crear");
  if (guard.error) return guard.error;

  await asegurarSchemaFlota().catch(() => undefined);

  const vehiculoId = Number(raw);
  if (!vehiculoId) {
    return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  }

  const form = await req.formData();
  const tipo = String(form.get("tipo") ?? "");
  if (!TIPOS_VALIDOS.has(tipo as TipoDocumentoVehiculo)) {
    return NextResponse.json(
      { error: "Tipo de documento inválido." },
      { status: 400 },
    );
  }
  const estadoRaw = String(form.get("estado") ?? "Vigente");
  const estado = estadoRaw === "Inactivo" ? "Inactivo" : "Vigente";
  const titulo = form.get("titulo") ? String(form.get("titulo")) : null;
  const fechaVencimiento = form.get("fechaVencimiento")
    ? String(form.get("fechaVencimiento"))
    : null;
  const notas = form.get("notas") ? String(form.get("notas")) : null;
  const file = form.get("file");

  let archivo: {
    rutaRelativa: string;
    nombreOriginal: string;
    mime: string | null;
    tamano: number;
  } | null = null;

  if (file instanceof File) {
    try {
      const saved = await guardarUpload(
        guard.empresa.id,
        "flota",
        `veh${vehiculoId}-doc`,
        file,
      );
      archivo = {
        rutaRelativa: saved.relative,
        nombreOriginal: saved.original,
        mime: contentTypeFor(saved.original),
        tamano: saved.size,
      };
    } catch (e) {
      console.error("upload documento vehiculo", e);
      return NextResponse.json(
        { error: "No se pudo guardar el archivo." },
        { status: 500 },
      );
    }
  }

  const r = await crearDocumentoVehiculo({
    empresaId: guard.empresa.id,
    vehiculoId,
    tipo: tipo as TipoDocumentoVehiculo,
    titulo,
    estado,
    fechaVencimiento,
    notas,
    archivo,
    subidoPor: guard.session.username,
  });

  if (!r.ok) {
    return NextResponse.json({ error: r.mensaje }, { status: 400 });
  }
  return NextResponse.json({ mensaje: r.mensaje, id: r.id, creadoEn: ahoraLocal() });
}