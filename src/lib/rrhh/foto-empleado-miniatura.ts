import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, rename, stat, unlink, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import sharp from "sharp";
import type { RowDataPacket } from "mysql2";
import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getUploadsRoot } from "@/lib/uploads";
import { FILTRO_FOTO_EMPLEADO } from "./foto-empleado-existencia";
import { MAX_FOTO_EMPLEADO, tipoFotoEmpleado } from "./foto-empleado";

const VERSION = "webp-160-v1";
const EN_CURSO = new Map<string, Promise<void>>();
let generando = 0;
const espera: (() => void)[] = [];
const PRIVADAS = { "Cache-Control": "private, no-cache", "Vary": "Cookie", "X-Content-Type-Options": "nosniff" };
const SIN_CACHE = { "Cache-Control": "private, no-store" };

function dentro(archivo: string, directorio: string) {
  if (!archivo.startsWith(directorio + sep)) throw new Error("Ruta de miniatura inválida.");
}

async function leerRutaPrivada(archivo: string, directorio: string) {
  const ruta = await realpath(archivo);
  dentro(ruta, directorio);
  return ruta;
}

async function generar(original: string, destino: string) {
  const bytes = await readFile(original);
  if (bytes.length > MAX_FOTO_EMPLEADO || !tipoFotoEmpleado(bytes)) throw new Error("Fotografía inválida.");
  const derivado = await sharp(bytes, { limitInputPixels: 100_000_000, animated: false })
    .rotate()
    .resize({ width: 160, height: 160, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 75 })
    .toBuffer();
  const temporal = destino + "." + randomUUID() + ".tmp";
  try {
    await writeFile(temporal, derivado, { flag: "wx", mode: 0o600 });
    await rename(temporal, destino);
  } finally {
    await unlink(temporal).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}

// Acota RAM/CPU en el primer acceso de muchas fotos: no leer originales hasta tener un turno.
async function generarLimitado(original: string, destino: string) {
  if (generando >= 2) await new Promise<void>((turno) => espera.push(turno));
  else generando++;
  try { await generar(original, destino); }
  finally {
    const siguiente = espera.shift();
    if (siguiente) siguiente(); // Transfiere el turno reservado; no incrementa el contador.
    else generando--;
  }
}

/** Derivado privado: el caller DEBE validar sesión, permiso y pertenencia del empleado antes, incluso para 304. */
export async function respuestaMiniaturaEmpleado(req: Request, empresaId: number, empleadoId: number) {
  const rows = await query<RowDataPacket[]>(
    `SELECT id, ruta_archivo FROM documentos_empleados
     WHERE empresa_id = ? AND id_empleado = ? AND ${FILTRO_FOTO_EMPLEADO}
     ORDER BY subido_en DESC, id DESC LIMIT 1`, [empresaId, empleadoId],
  );
  if (!rows[0]) return NextResponse.json({ error: "Sin fotografía registrada." }, { status: 404, headers: SIN_CACHE });
  const raiz = getUploadsRoot();
  const dir = resolve(raiz, "empresas", String(empresaId), "documentos");
  const original = resolve(raiz, String(rows[0].ruta_archivo));
  dentro(original, dir);
  try {
    const dirReal = await realpath(dir);
    const raizReal = await realpath(raiz);
    if (dirReal !== resolve(raizReal, "empresas", String(empresaId), "documentos")) {
      throw new Error("Ruta de miniatura inválida.");
    }
    const originalReal = await leerRutaPrivada(original, dirReal);
    const info = await stat(originalReal);
    if (!info.isFile() || info.size > MAX_FOTO_EMPLEADO) {
      return NextResponse.json({ error: "Fotografía no disponible." }, { status: 404, headers: SIN_CACHE });
    }
    // Documento + archivo + versión del generador: nueva foto nunca reutiliza el derivado anterior.
    const clave = createHash("sha256").update(JSON.stringify([
      VERSION, empresaId, empleadoId, Number(rows[0].id), rows[0].ruta_archivo, info.size, info.mtimeMs,
    ])).digest("hex");
    const cacheDir = join(dirReal, ".miniaturas");
    await mkdir(cacheDir, { recursive: true, mode: 0o700 });
    const cacheReal = await realpath(cacheDir);
    dentro(cacheReal, dirReal);
    const destino = join(cacheReal, clave + ".webp");
    let existe = false;
    try {
      const ruta = await leerRutaPrivada(destino, cacheReal);
      const datos = await stat(ruta);
      if (!datos.isFile() || datos.size > MAX_FOTO_EMPLEADO) throw new Error("Miniatura inválida.");
      existe = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (!existe) {
      let trabajo = EN_CURSO.get(destino);
      if (!trabajo) {
        trabajo = generarLimitado(originalReal, destino);
        EN_CURSO.set(destino, trabajo);
      }
      try { await trabajo; }
      finally { if (EN_CURSO.get(destino) === trabajo) EN_CURSO.delete(destino); }
    }
    const etag = `W/"${clave}"`;
    const headers = { ...PRIVADAS, ETag: etag };
    const coincide = req.headers.get("if-none-match")?.split(",").some((valor) =>
      valor.trim() === "*" || valor.trim().replace(/^W\//, "") === etag.replace(/^W\//, ""));
    if (coincide) return new NextResponse(null, { status: 304, headers });
    const bytes = await readFile(await leerRutaPrivada(destino, cacheReal));
    return new NextResponse(new Uint8Array(bytes), { headers: {
      ...headers, "Content-Type": "image/webp", "Content-Length": String(bytes.length), "Content-Disposition": "inline",
    } });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return NextResponse.json({ error: "Fotografía no encontrada." }, { status: 404, headers: SIN_CACHE });
    }
    throw error;
  }
}
