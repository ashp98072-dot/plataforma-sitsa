import { NextResponse } from "next/server";
import { requireTenantRrhh } from "@/lib/tenant";
import { calcularCuadreIgssMensual } from "@/lib/rrhh/planillas";

type Ctx = { params: Promise<{ slug: string }> };

/**
 * Fase D3: conciliación de IGSS quincenal para un mes/año — solo lectura,
 * no modifica ninguna línea. Ver calcularCuadreIgssMensual en planillas.ts.
 */
export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "planillas", "ver");
  if (guard.error) return guard.error;

  const url = new URL(req.url);
  const mes = Number(url.searchParams.get("mes"));
  const anio = Number(url.searchParams.get("anio"));
  if (!Number.isFinite(mes) || mes < 1 || mes > 12 || !Number.isFinite(anio) || anio < 2000) {
    return NextResponse.json(
      { error: "Parámetros inválidos (mes, anio)." },
      { status: 400 },
    );
  }

  try {
    const cuadre = await calcularCuadreIgssMensual(guard.empresa.id, mes, anio);
    return NextResponse.json(cuadre, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    console.error("GET rrhh/planillas/cuadre-igss", e);
    return NextResponse.json(
      { error: "No se pudo calcular el cuadre de IGSS." },
      { status: 500 },
    );
  }
}
