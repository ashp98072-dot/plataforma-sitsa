import { NextResponse } from "next/server";
import { requireTenantFlota } from "@/lib/tenant";
import { asegurarSchemaFlota } from "@/lib/flota/schema";
import { buscarPlanesParaSalida } from "@/lib/tms/planes-salida";

type Ctx = { params: Promise<{ slug: string }> };

/** Planes TMS del día que coinciden con piloto y/o placa. */
export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantFlota(slug, "flota_piloto", "ver");
  if (guard.error) return guard.error;

  try {
    await asegurarSchemaFlota();
  } catch {
    /* ok */
  }

  const url = new URL(req.url);
  const planes = await buscarPlanesParaSalida(guard.empresa.id, {
    pilotoNombre: url.searchParams.get("piloto") ?? undefined,
    placa: url.searchParams.get("placa") ?? undefined,
    fecha: url.searchParams.get("fecha") ?? undefined,
  });

  return NextResponse.json({
    planes,
    sugerido: planes.length === 1 ? planes[0] : null,
  });
}
