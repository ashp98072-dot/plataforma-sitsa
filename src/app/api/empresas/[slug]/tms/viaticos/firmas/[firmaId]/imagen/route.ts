import { createReadStream, existsSync, statSync } from "fs";
import { NextResponse } from "next/server";
import { Readable } from "stream";
import type { RowDataPacket } from "mysql2";
import { requireTenantViaticosAny } from "@/lib/tenant";
import { query } from "@/lib/db";
import { absPathFromRelative, contentTypeFor } from "@/lib/uploads";

type Ctx = { params: Promise<{ slug: string; firmaId: string }> };

/**
 * VIATICOS-FIRMA-VISUAL — sirve la imagen PNG manuscrita de UNA firma
 * electrónica interna de Viáticos. Mismo patrón que
 * operaciones/multas/documentos/[docId]/route.ts y empleados/[id]/foto/
 * route.ts: nunca una ruta pública directa a /uploads — siempre por
 * endpoint autenticado que valida sesión + empresa + acceso al módulo.
 *
 * Permiso: requireTenantViaticosAny (CUALQUIERA de viaticos/
 * viaticos_autorizar/viaticos_pagar/viaticos_liquidar con `ver`) — el
 * mismo nivel de acceso que ya ve estas filas en el listado de control
 * (/tms/viaticos/control). El WHERE además exige modulo='VIATICOS' AND
 * entidad_tipo='VIATICO' — defensa en profundidad: este endpoint nunca
 * sirve una imagen de firma de otro módulo aunque el id coincidiera.
 */
export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { slug, firmaId } = await ctx.params;
    const guard = await requireTenantViaticosAny(slug, "ver");
    if (guard.error) return guard.error;

    const id = Number(firmaId);
    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: "ID inválido." }, { status: 400 });
    }

    const rows = await query<RowDataPacket[]>(
      `SELECT imagen_ruta, imagen_mime FROM firmas_electronicas
       WHERE id = ? AND empresa_id = ? AND modulo = 'VIATICOS' AND entidad_tipo = 'VIATICO'
       LIMIT 1`,
      [id, guard.empresa.id],
    );
    const row = rows[0];
    if (!row || !row.imagen_ruta) {
      return NextResponse.json({ error: "Sin imagen de firma." }, { status: 404 });
    }

    const abs = absPathFromRelative(String(row.imagen_ruta));
    if (!existsSync(abs)) {
      return NextResponse.json({ error: "Archivo no encontrado en disco." }, { status: 404 });
    }
    const stat = statSync(abs);
    const stream = createReadStream(abs);
    const webStream = Readable.toWeb(stream) as unknown as BodyInit;
    return new NextResponse(webStream, {
      headers: {
        "Content-Type": row.imagen_mime ? String(row.imagen_mime) : contentTypeFor(String(row.imagen_ruta)),
        "Content-Length": String(stat.size),
        "Cache-Control": "private, no-store",
        "Content-Disposition": "inline",
      },
    });
  } catch (error) {
    console.error("GET imagen firma viático", error);
    return NextResponse.json({ error: "No se pudo leer la imagen." }, { status: 500 });
  }
}
