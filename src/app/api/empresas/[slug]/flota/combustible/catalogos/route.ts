import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { requireTenantFlotaCombustible } from "@/lib/tenant";
import { catalogosCombustible } from "@/lib/flota/combustible-staff";
import { query } from "@/lib/db";
import type { RowDataPacket } from "mysql2";
export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const guard = await requireTenantFlotaCombustible(slug, "ver");
  if (guard.error) return guard.error;
  try {
    const catalogos = await catalogosCombustible(guard.empresa.id);
    // Lectura del catálogo operativo real. No usa helpers que reparan vínculos de RRHH.
    let pilotos: { id: number; nombre: string }[] = [];
    let limitacionPilotos = "CB2 conserva el piloto leído del Excel, pero no dispone de una relación con tms_personal. Las sugerencias son informativas; no se guarda una asociación. Para corregir el nombre persistido, corrige el Excel y vuelve a analizar.";
    try {
      const personal = await query<RowDataPacket[]>("SELECT id, nombre FROM tms_personal WHERE empresa_id = ? AND tipo = 'Piloto' AND estado = 'Activo' ORDER BY nombre, id", [guard.empresa.id]);
      pilotos = personal.map(p => ({ id: Number(p.id), nombre: String(p.nombre) }));
    } catch { limitacionPilotos = "Catálogo de pilotos no disponible en esta instalación. " + limitacionPilotos; }
    return NextResponse.json({ ...catalogos, pilotos, limitacionPilotos }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    // Siempre JSON con mensaje (antes un fallo de cualquiera de las 3 consultas daba un 500 vacío y selectores en blanco sin explicación).
    const referencia = randomUUID().slice(0, 8);
    console.error(`[combustible-catalogos] ref=${referencia}`, e);
    return NextResponse.json({ error: `No se pudieron cargar los catálogos de combustible. Referencia ${referencia}.` }, { status: 500 });
  }
}
