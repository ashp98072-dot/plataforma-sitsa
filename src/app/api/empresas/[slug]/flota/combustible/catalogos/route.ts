import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { requireTenantFlotaCombustible } from "@/lib/tenant";
import { catalogosCombustible } from "@/lib/flota/combustible-staff";
export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const guard = await requireTenantFlotaCombustible(slug, "ver");
  if (guard.error) return guard.error;
  try {
    return NextResponse.json(await catalogosCombustible(guard.empresa.id), { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    // Siempre JSON con mensaje (antes un fallo de cualquiera de las 3 consultas daba un 500 vacío y selectores en blanco sin explicación).
    const referencia = randomUUID().slice(0, 8);
    console.error(`[combustible-catalogos] ref=${referencia}`, e);
    return NextResponse.json({ error: `No se pudieron cargar los catálogos de combustible. Referencia ${referencia}.` }, { status: 500 });
  }
}
