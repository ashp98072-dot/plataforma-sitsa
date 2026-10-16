import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { requireTenantFlotaCombustible } from "@/lib/tenant";
import { validarRutaArchivoEmpresa } from "@/lib/uploads";
import { archivoImportacion } from "@/lib/flota/combustible-importaciones";
import { MIME_XLSX } from "@/lib/flota/combustible-importacion-parser";
export async function GET(_req: Request, ctx: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await ctx.params;
  const g = await requireTenantFlotaCombustible(slug, "ver"); if (g.error) return g.error;
  if (!Number.isSafeInteger(Number(id)) || Number(id) <= 0) return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  const archivo = await archivoImportacion(g.empresa.id, Number(id));
  const path = archivo && validarRutaArchivoEmpresa(g.empresa.id, archivo.ruta_relativa);
  if (!path) return NextResponse.json({ error: "Archivo no encontrado." }, { status: 404 });
  try {
    return new NextResponse(await readFile(path), { headers: { "Content-Type": MIME_XLSX, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Disposition": `attachment; filename="${encodeURIComponent(String(archivo!.nombre_original))}"` } });
  } catch { return NextResponse.json({ error: "Archivo no disponible." }, { status: 404 }); }
}
