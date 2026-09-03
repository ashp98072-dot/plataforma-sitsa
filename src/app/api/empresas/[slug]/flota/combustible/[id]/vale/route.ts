import { readFileSync } from "fs";
import { NextResponse } from "next/server";
import { requireTenantFlotaCombustible } from "@/lib/tenant";
import { obtenerArchivoCargaCombustiblePorEmpresa } from "@/lib/flota/combustible";
import { absPathFromRelative, contentTypeFor } from "@/lib/uploads";

type Ctx = { params: Promise<{ slug: string; id: string }> };

/** FLOTA-COMBUSTIBLE-1 (Fase 2) — servir la foto del vale para revisión de Operaciones. */
export async function GET(_req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireTenantFlotaCombustible(slug, "ver");
  if (guard.error) return guard.error;

  const cargaId = Number(id);
  if (!cargaId) return NextResponse.json({ error: "ID inválido." }, { status: 400 });

  const archivo = await obtenerArchivoCargaCombustiblePorEmpresa(guard.empresa.id, cargaId);
  if (!archivo) return NextResponse.json({ error: "Vale no encontrado." }, { status: 404 });
  try {
    return new NextResponse(readFileSync(absPathFromRelative(archivo.rutaRelativa)), {
      headers: {
        "Content-Type": archivo.mime || contentTypeFor(archivo.nombreOriginal),
        "Content-Disposition": `inline; filename="${archivo.nombreOriginal.replace(/"/g, "")}"`,
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch {
    return NextResponse.json({ error: "Archivo no encontrado." }, { status: 404 });
  }
}
