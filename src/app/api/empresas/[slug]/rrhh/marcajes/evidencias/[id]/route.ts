import { readFileSync } from "fs";
import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { query } from "@/lib/db";
import { requireTenantRrhh } from "@/lib/tenant";
import { absPathFromRelative, contentTypeFor } from "@/lib/uploads";

type Ctx = { params: Promise<{ slug: string; id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { slug, id: rawId } = await ctx.params;
  const guardMarcajes = await requireTenantRrhh(slug, "marcajes", "ver");
  const guard = guardMarcajes.error
    ? await requireTenantRrhh(slug, "reportes", "ver")
    : guardMarcajes;
  if (guard.error) return guard.error;
  if (guard.session.rol === "Marcaje") {
    return NextResponse.json(
      { error: "Las fotografías de marcaje solo están disponibles para RRHH autorizado." },
      { status: 403 },
    );
  }

  const id = Number(rawId);
  if (!Number.isInteger(id) || id < 1) {
    return NextResponse.json({ error: "Evidencia inválida." }, { status: 400 });
  }

  const rows = await query<RowDataPacket[]>(
    `SELECT ruta_relativa, nombre_original, mime
     FROM marcaje_evidencias
     WHERE id = ? AND empresa_id = ? LIMIT 1`,
    [id, guard.empresa.id],
  ).catch(() => [] as RowDataPacket[]);
  if (!rows[0]) {
    return NextResponse.json({ error: "Fotografía no encontrada." }, { status: 404 });
  }

  try {
    const nombre = String(rows[0].nombre_original);
    return new NextResponse(readFileSync(absPathFromRelative(String(rows[0].ruta_relativa))), {
      headers: {
        "Content-Type": String(rows[0].mime || contentTypeFor(nombre)),
        "Content-Disposition": `inline; filename="${nombre.replace(/"/g, "")}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "Archivo no encontrado." }, { status: 404 });
  }
}
