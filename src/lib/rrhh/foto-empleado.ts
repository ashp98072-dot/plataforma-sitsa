import { readFile, stat } from "fs/promises";
import { resolve, sep } from "path";
import type { RowDataPacket } from "mysql2";
import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getUploadsRoot } from "@/lib/uploads";

export const MAX_FOTO_EMPLEADO = 5 * 1024 * 1024;
export function tipoFotoEmpleado(bytes: Uint8Array): string | null {
  const b = Buffer.from(bytes);
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (b.length >= 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}
const privadas = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
export async function respuestaFotoEmpleado(empresaId: number, empleadoId: number) {
  const rows = await query<RowDataPacket[]>(
    `SELECT id, ruta_archivo FROM documentos_empleados
     WHERE empresa_id = ? AND id_empleado = ? AND tipo_documento = 'Foto'
       AND LOWER(ruta_archivo) REGEXP '[.](jpg|jpeg|png|webp)$'
     ORDER BY subido_en DESC, id DESC LIMIT 1`, [empresaId, empleadoId]);
  if (!rows[0]) return NextResponse.json({ error: "Sin fotografía registrada." }, { status: 404, headers: privadas });
  const dir = resolve(getUploadsRoot(), "empresas", String(empresaId), "documentos");
  const archivo = resolve(getUploadsRoot(), String(rows[0].ruta_archivo));
  if (!archivo.startsWith(dir + sep)) throw new Error("Ruta de fotografía inválida.");
  try {
    const info = await stat(archivo);
    if (!info.isFile() || info.size > MAX_FOTO_EMPLEADO) return NextResponse.json({ error: "Fotografía no disponible." }, { status: 404, headers: privadas });
    const bytes = await readFile(archivo);
    const tipo = tipoFotoEmpleado(bytes);
    if (!tipo) return NextResponse.json({ error: "Fotografía no disponible." }, { status: 404, headers: privadas });
    return new NextResponse(new Uint8Array(bytes), { headers: { ...privadas, "Content-Type": tipo, "Content-Disposition": "inline" } });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return NextResponse.json({ error: "Fotografía no encontrada." }, { status: 404, headers: privadas });
    throw error;
  }
}
