import { createReadStream, existsSync, statSync } from "fs";
import { extname } from "path";
import { Readable } from "stream";
import { NextResponse } from "next/server";
import { requireComprasRequerimientos } from "./acceso";
import {
  lineaPerteneceARequerimiento,
  listarDocumentosLinea,
  obtenerDocumentoLinea,
  registrarDocumentoLinea,
  retirarDocumentoLinea,
  TIPOS_LINEA_DOCUMENTO,
  type TipoLineaDocumento,
} from "./linea-documentos";
import { absPathFromRelative, borrarUpload, contentTypeFor, guardarUpload, UploadValidationError } from "@/lib/uploads";

// Whitelist LOCAL de Compras — más angosta que EXT_PERMITIDAS de
// src/lib/uploads.ts (que también acepta .bmp para otros módulos que sí lo
// necesitan). No se toca la constante global; esta validación es
// adicional y específica de documentos de línea de compras. Mismo criterio
// ya usado en operaciones/multas/[id]/documentos/route.ts
// (EXT_PERMITIDAS_MULTAS).
const EXT_PERMITIDAS_COMPRAS = new Set([".pdf", ".jpg", ".jpeg", ".png", ".webp"]);
const MIME_POR_EXTENSION_COMPRAS: Record<string, string> = {
  ".pdf": "application/pdf",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

/**
 * COMPRAS-FASE-3-DOCUMENTOS-LINEA — capa HTTP delgada, mismo patrón que
 * requerimiento-api.ts (respuesta() con Cache-Control no-store en toda
 * respuesta, incluida la del guard) y que
 * operaciones/multas/[id]/documentos/route.ts (subir/servir archivo).
 */
const respuesta = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
const idValido = (id: string) => /^[1-9]\d*$/.test(id) && Number.isSafeInteger(Number(id)) && Number(id) <= 2147483647;
function fallo(error: unknown, generico = "No se pudo procesar la solicitud.") {
  console.error("[compras][linea-documentos]", error);
  return respuesta({ error: generico }, 500);
}

async function resolverLinea(slug: string, accion: "ver" | "crear" | "editar" | "eliminar", rawId: string, rawLineaId: string) {
  const guard = await requireComprasRequerimientos(slug, accion);
  if (guard.error) {
    guard.error.headers.set("Cache-Control", "private, no-store");
    return { error: guard.error } as const;
  }
  if (!idValido(rawId) || !idValido(rawLineaId)) {
    return { error: respuesta({ error: "Línea no encontrada." }, 404) } as const;
  }
  const requerimientoId = Number(rawId);
  const lineaId = Number(rawLineaId);
  const pertenece = await lineaPerteneceARequerimiento(guard.empresa.id, requerimientoId, lineaId);
  if (!pertenece) {
    return { error: respuesta({ error: "Línea no encontrada." }, 404) } as const;
  }
  return { guard, requerimientoId, lineaId } as const;
}

/** GET .../requerimientos/[id]/lineas/[lineaId]/documentos — listar (compras_requerimientos:ver). */
export async function lineaDocumentosGet(slug: string, rawId: string, rawLineaId: string) {
  const r = await resolverLinea(slug, "ver", rawId, rawLineaId);
  if (r.error) return r.error;
  try {
    const documentos = await listarDocumentosLinea(r.guard.empresa.id, r.requerimientoId, r.lineaId);
    return respuesta({ documentos });
  } catch (error) {
    return fallo(error, "No se pudieron listar los documentos de la línea.");
  }
}

/** POST .../requerimientos/[id]/lineas/[lineaId]/documentos — subir (compras_requerimientos:editar). */
export async function lineaDocumentoSubir(req: Request, slug: string, rawId: string, rawLineaId: string) {
  const r = await resolverLinea(slug, "editar", rawId, rawLineaId);
  if (r.error) return r.error;
  const { guard, requerimientoId, lineaId } = r;
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return respuesta(
      { error: "No se pudo recibir el archivo completo. Intenta nuevamente con un archivo más pequeño." },
      400,
    );
  }
  const file = form.get("file") as File | null;
  const tipoRaw = String(form.get("tipo") ?? "");
  if (!file || typeof file.arrayBuffer !== "function") {
    return respuesta({ error: "Archivo requerido." }, 400);
  }
  if (!(TIPOS_LINEA_DOCUMENTO as readonly string[]).includes(tipoRaw)) {
    return respuesta({ error: "Tipo de documento no permitido." }, 400);
  }
  const tipo = tipoRaw as TipoLineaDocumento;

  // Validación específica de Compras — MÁS estricta que EXT_PERMITIDAS
  // compartida (rechaza .bmp aquí aunque guardarUpload() la acepte para
  // otros módulos). El atributo accept del <input> del navegador no es
  // seguridad — esta es la validación server-side real.
  const ext = extname(file.name || "").toLowerCase();
  if (!EXT_PERMITIDAS_COMPRAS.has(ext)) {
    return respuesta({ error: "Formato no permitido. Usa: pdf, jpg, jpeg, png o webp." }, 400);
  }
  // No hay magic-byte sniffing en este proyecto (ver guardarUpload()): como
  // mínimo, si el navegador SÍ declaró un MIME específico, debe coincidir
  // con la extensión — nunca se acepta un MIME incompatible declarado.
  // "application/octet-stream" (el valor que un multipart/form-data real
  // asigna a una parte SIN Content-Type explícito — verificado con un
  // round-trip real de Request/FormData, no solo con el File en memoria)
  // se trata igual que "sin declarar": no hay nada específico que
  // contrastar, se deja pasar por extensión.
  const mimeEsperado = MIME_POR_EXTENSION_COMPRAS[ext];
  const mimeDeclarado = file.type && file.type !== "application/octet-stream" ? file.type : null;
  if (mimeDeclarado && mimeDeclarado !== mimeEsperado) {
    return respuesta({ error: "El tipo de archivo (MIME) no coincide con su extensión." }, 400);
  }

  let saved: Awaited<ReturnType<typeof guardarUpload>> | undefined;
  try {
    saved = await guardarUpload(guard.empresa.id, "compras", `req${requerimientoId}_linea${lineaId}`, file);
    const docId = await registrarDocumentoLinea({
      empresaId: guard.empresa.id,
      requerimientoId,
      lineaId,
      tipo,
      rutaRelativa: saved.relative,
      nombreOriginal: saved.original,
      mime: file.type || "application/octet-stream",
      tamano: saved.size,
      subidoPorUsuarioId: guard.session.id,
    });
    return respuesta({ mensaje: "Documento subido.", id: docId }, 201);
  } catch (error) {
    if (saved?.relative) borrarUpload(saved.relative);
    if (error instanceof UploadValidationError) return respuesta({ error: error.message }, error.status);
    return fallo(error, "No se pudo completar la carga del documento. Intenta nuevamente.");
  }
}

/** GET .../requerimientos/documentos/[docId] — servir el archivo (compras_requerimientos:ver). */
export async function lineaDocumentoServir(slug: string, rawDocId: string) {
  const guard = await requireComprasRequerimientos(slug, "ver");
  if (guard.error) {
    guard.error.headers.set("Cache-Control", "private, no-store");
    return guard.error;
  }
  if (!idValido(rawDocId)) return respuesta({ error: "No encontrado." }, 404);
  try {
    const doc = await obtenerDocumentoLinea(guard.empresa.id, Number(rawDocId));
    if (!doc) return respuesta({ error: "No encontrado." }, 404);
    const abs = absPathFromRelative(doc.rutaRelativa);
    if (!existsSync(abs)) return respuesta({ error: "Archivo no encontrado en disco." }, 404);
    const stat = statSync(abs);
    const stream = createReadStream(abs);
    const webStream = Readable.toWeb(stream) as unknown as BodyInit;
    return new NextResponse(webStream, {
      headers: {
        "Content-Type": contentTypeFor(doc.rutaRelativa),
        "Content-Length": String(stat.size),
        "Content-Disposition": `inline; filename="${encodeURIComponent(doc.nombreOriginal || "documento")}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return fallo(error, "No se pudo leer el archivo.");
  }
}

/** DELETE .../requerimientos/documentos/[docId] — retirar (compras_requerimientos:eliminar). */
export async function lineaDocumentoRetirar(req: Request, slug: string, rawDocId: string) {
  const guard = await requireComprasRequerimientos(slug, "eliminar");
  if (guard.error) {
    guard.error.headers.set("Cache-Control", "private, no-store");
    return guard.error;
  }
  if (!idValido(rawDocId)) return respuesta({ error: "No encontrado." }, 404);
  const body = await req.json().catch(() => ({}));
  const motivo = String((body as { motivo?: unknown }).motivo ?? "").trim() || null;
  try {
    const r = await retirarDocumentoLinea(guard.empresa.id, Number(rawDocId), guard.session.id, motivo);
    return r.ok ? respuesta({ mensaje: r.mensaje }) : respuesta({ error: r.mensaje }, r.status);
  } catch (error) {
    return fallo(error, "No se pudo eliminar el documento.");
  }
}
