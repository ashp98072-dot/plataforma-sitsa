import { createWriteStream, existsSync, mkdirSync, unlinkSync } from "fs";
import { dirname, extname, join, resolve } from "path";
import { randomBytes } from "crypto";
import { pipeline } from "stream/promises";
import { Readable } from "stream";

export const EXT_PERMITIDAS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".bmp",
  ".pdf",
]);

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

/** Raíz persistente en Hostinger: .builds/uploads (fuera de versions/). */
export function getUploadsRoot(): string {
  if (process.env.UPLOAD_DIR?.trim()) {
    return resolve(process.env.UPLOAD_DIR.trim());
  }
  const cwd = process.cwd();
  if (existsSync(join(cwd, "..", "..", "..", "config"))) {
    return resolve(join(cwd, "..", "..", "..", "uploads"));
  }
  return resolve(join(cwd, "uploads"));
}

export function absPathFromRelative(relative: string): string {
  const root = getUploadsRoot();
  const abs = resolve(root, relative);
  if (!abs.startsWith(root)) {
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

export async function guardarUpload(
  empresaId: number,
  subdir: "documentos" | "evidencias",
  prefix: string,
  file: File,
): Promise<{ relative: string; original: string; size: number }> {
  if (file.size <= 0) throw new Error("Archivo vacío.");
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error("El archivo supera el máximo de 8 MB.");
  }
  const ext = extensionValida(file.name);
  if (!ext) {
    throw new Error("Formato no permitido. Usa: jpg, png, webp, bmp o pdf.");
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
  const relative = join("empresas", String(empresaId), subdir, filename).replace(
    /\\/g,
    "/",
  );
  const abs = join(dir, filename);

  const buffer = Buffer.from(await file.arrayBuffer());
  ensureDir(dirname(abs));
  await pipeline(Readable.from(buffer), createWriteStream(abs));

  return {
    relative,
    original: file.name.slice(0, 255),
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
    default:
      return "application/octet-stream";
  }
}
