import {
  existsSync,
  mkdirSync,
  unlinkSync,
} from "fs";
import { writeFile } from "fs/promises";
import { dirname, extname, join, resolve, sep } from "path";
import { randomBytes } from "crypto";
import { EXT_PERMITIDAS, MAX_UPLOAD_BYTES } from "@/lib/uploads-constants";

// RRHH-EXPEDIENTES-UPLOAD-STABILITY: re-exportadas tal cual desde
// uploads-constants.ts (ver ese archivo) — sigue siendo válido
// `import { MAX_UPLOAD_BYTES } from "@/lib/uploads"` en los 2
// consumidores existentes que ya lo hacían (src/lib/firmas/imagen-firma.ts,
// operaciones/multas/[id]/documentos/route.ts), sin ningún cambio en ellos.
export { EXT_PERMITIDAS, MAX_UPLOAD_BYTES };

/** Raíz persistente en Hostinger: .builds/uploads (fuera de versions/). */
export function getUploadsRoot(): string {
  if (process.env.UPLOAD_DIR?.trim()) {
    return resolve(process.env.UPLOAD_DIR.trim());
  }
  const cwd = process.cwd();
  const candidates = [
    // .builds/current → .builds/uploads
    join(cwd, "..", "uploads"),
    // .builds/versions/<id> → .builds/uploads
    join(cwd, "..", "..", "uploads"),
    // .builds/versions/<id>/nodejs → .builds/uploads
    join(cwd, "..", "..", "..", "uploads"),
    join(cwd, "uploads"),
  ];
  for (const dir of candidates) {
    const abs = resolve(dir);
    const siblingConfig = join(dirname(abs), "config");
    if (existsSync(siblingConfig) || existsSync(abs)) {
      return abs;
    }
  }
  // Crear uploads junto al cwd si no hay estructura Hostinger
  return resolve(join(cwd, "uploads"));
}

export function absPathFromRelative(relative: string): string {
  const root = getUploadsRoot();
  const abs = resolve(root, relative);
  const rootNorm = root.endsWith(sep) ? root : root + sep;
  if (abs !== root && !abs.startsWith(rootNorm) && !abs.startsWith(root)) {
    throw new Error("Ruta de archivo inválida.");
  }
  return abs;
}

export function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function extensionValida(nombre: string): string | null {
  const ext = extname(nombre).toLowerCase();
  return EXT_PERMITIDAS.has(ext) ? ext : null;
}

type UploadLike = {
  name: string;
  size: number;
  arrayBuffer: () => Promise<ArrayBuffer>;
};

/**
 * AJUSTE PRE-MERGE PR #176 (punto 2) — error FUNCIONAL conocido de
 * validación de subida (nunca un fallo interno: archivo vacío, formato
 * no permitido, tamaño excedido). Un caller puede distinguirlo con
 * `instanceof UploadValidationError` en vez de comparar el texto del
 * mensaje (frágil) para decidir si el mensaje es seguro de mostrar tal
 * cual al usuario y qué status HTTP usar — sin necesidad de un refactor
 * más amplio de manejo de errores. Sigue siendo un `Error` normal para
 * cualquier caller existente que solo haga `err instanceof Error ?
 * err.message : ...` (los otros 14 consumidores de guardarUpload) — no
 * cambia su comportamiento.
 */
export class UploadValidationError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "UploadValidationError";
    this.status = status;
  }
}

export async function guardarUpload(
  empresaId: number,
  // VIATICOS-FIRMA (firma visual) — "firmas": imágenes PNG de firma
  // manuscrita (src/lib/tms/viaticos.ts autorizarViatico/liquidarViatico).
  subdir: "documentos" | "evidencias" | "flota" | "multas" | "firmas",
  prefix: string,
  file: UploadLike,
): Promise<{ relative: string; original: string; size: number }> {
  if (!file || typeof file.arrayBuffer !== "function") {
    throw new UploadValidationError("Archivo requerido.", 400);
  }
  if (file.size <= 0) throw new UploadValidationError("Archivo vacío.", 400);
  if (file.size > MAX_UPLOAD_BYTES) {
    // 413 Payload Too Large — es el único de los 3 casos donde el
    // tamaño en sí (no el contenido/formato) es la causa; el resto se
    // documenta como 400 (ver AJUSTE PRE-MERGE PR #176, punto 2).
    throw new UploadValidationError("El archivo supera el máximo de 50 MB.", 413);
  }
  const ext = extensionValida(file.name || "archivo.jpg");
  if (!ext) {
    throw new UploadValidationError("Formato no permitido. Usa: jpg, png, webp, bmp o pdf.", 400);
  }

  const root = getUploadsRoot();
  const dir = join(root, "empresas", String(empresaId), subdir);
  ensureDir(dir);

  const stamp = new Date()
    .toISOString()
    .replace(/[-:TZ.]/g, "")
    .slice(0, 14);
  const rand = randomBytes(4).toString("hex");
  const filename = `${prefix}_${stamp}_${rand}${ext}`;
  const relative = join(
    "empresas",
    String(empresaId),
    subdir,
    filename,
  ).replace(/\\/g, "/");
  const abs = join(dir, filename);

  const buffer = Buffer.from(await file.arrayBuffer());
  ensureDir(dirname(abs));
  // RRHH-EXPEDIENTES-UPLOAD-STABILITY (MEJORA A — sección 5 del ticket):
  // writeFile (fs/promises) en vez de writeFileSync — evita bloquear el
  // event loop de Node durante una escritura grande. guardarUpload()
  // siempre se llama con `await` (verificado en los 15 call sites
  // actuales: viáticos, marcajes de portal, evidencias de flota/lectura,
  // firmas de usuario, foto de empleado, documentos de empleado,
  // adjuntos/documentos de flota y servicios, documentos de multas,
  // evidencias de vacaciones, marcajes de RRHH, documentos de
  // entrevistas), así que el contrato "el archivo existe en disco cuando
  // guardarUpload() resuelve" se mantiene exactamente igual — ningún
  // caller depende de que la escritura sea síncrona, solo de que ya haya
  // terminado cuando su propio `await` continúa. MEJORA B (streaming
  // real, sin materializar el archivo completo en memoria) queda fuera
  // de este ticket — requeriría cambiar cómo se lee el multipart
  // (req.formData() ya materializa el archivo completo antes de llegar
  // aquí) y no hay un patrón de streaming ya existente en el repo para
  // reutilizar; ver el reporte final.
  await writeFile(abs, buffer);

  return {
    relative,
    original: String(file.name || filename).slice(0, 255),
    size: file.size,
  };
}

/**
 * FLOTA-COMBUSTIBLE-3 — guarda exclusivamente reportes Excel .xlsx
 * usados para conciliación de combustible.
 *
 * Se mantiene separado de guardarUpload() para NO ampliar los formatos
 * permitidos en fotos, evidencias, documentos u otros módulos existentes.
 */
export async function guardarUploadExcel(
  empresaId: number,
  subdir: "flota",
  prefix: string,
  file: UploadLike,
): Promise<{ relative: string; original: string; size: number }> {
  if (!file || typeof file.arrayBuffer !== "function") {
    throw new UploadValidationError("Archivo requerido.", 400);
  }

  if (file.size <= 0) {
    throw new UploadValidationError("Archivo vacío.", 400);
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    throw new UploadValidationError(
      "El archivo supera el máximo de 50 MB.",
      413,
    );
  }

  const ext = extname(file.name || "").toLowerCase();

  if (ext !== ".xlsx") {
    throw new UploadValidationError(
      "Formato no permitido. Debes subir un archivo Excel .xlsx.",
      400,
    );
  }

  const root = getUploadsRoot();
  const dir = join(
    root,
    "empresas",
    String(empresaId),
    subdir,
  );

  ensureDir(dir);

  const stamp = new Date()
    .toISOString()
    .replace(/[-:TZ.]/g, "")
    .slice(0, 14);

  const rand = randomBytes(4).toString("hex");

  const filename =
    `${prefix}_${stamp}_${rand}.xlsx`;

  const relative = join(
    "empresas",
    String(empresaId),
    subdir,
    filename,
  ).replace(/\\/g, "/");

  const abs = join(dir, filename);

  const buffer = Buffer.from(
    await file.arrayBuffer(),
  );

  ensureDir(dirname(abs));

  await writeFile(abs, buffer);

  return {
    relative,
    original: String(
      file.name || filename,
    ).slice(0, 255),
    size: file.size,
  };
}

export function borrarUpload(relative: string): void {
  try {
    const abs = absPathFromRelative(relative);
    if (existsSync(abs)) unlinkSync(abs);
  } catch {
    // ignore
  }
}

export function contentTypeFor(pathOrName: string): string {
  const ext = extname(pathOrName).toLowerCase();

  switch (ext) {
    case ".pdf":
      return "application/pdf";

    case ".png":
      return "image/png";

    case ".jpg":
    case ".jpeg":
      return "image/jpeg";

    case ".webp":
      return "image/webp";

    case ".bmp":
      return "image/bmp";

    case ".xlsx":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

    default:
      return "application/octet-stream";
  }
}
