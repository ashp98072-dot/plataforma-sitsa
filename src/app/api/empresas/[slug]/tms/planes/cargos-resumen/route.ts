import { NextResponse } from "next/server";
import { requireTenantProgramacionOTms } from "@/lib/tenant";
import { resumenCargosDePlanes } from "@/lib/tms/cargos-adicionales";
import { respuestaDeExcepcion } from "@/lib/validacion-formulario";

type Ctx = { params: Promise<{ slug: string }> };

const MAX_IDS = 500;

/**
 * LIQUIDACIÓN DE VIAJES, FASE 4 — resumen compacto («Cargos: n · Q total») de los cargos ACTIVOS de los viajes visibles en
 * Ajustes rápidos, en UNA consulta (sin N+1). Solo lectura; misma visibilidad que el listado de viajes. La empresa sale de la
 * sesión: un id de otra empresa simplemente no devuelve nada.
 */
export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantProgramacionOTms(slug, "ver");
  if (guard.error) return guard.error;

  const bruto = new URL(req.url).searchParams.get("ids") ?? "";
  const ids = bruto.split(",").map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0);
  if (ids.length > MAX_IDS) {
    return NextResponse.json({ error: `Máximo ${MAX_IDS} viajes por consulta.` }, { status: 400 });
  }
  try {
    const mapa = await resumenCargosDePlanes(guard.empresa.id, ids);
    return NextResponse.json({ resumen: Object.fromEntries(mapa) });
  } catch (e) {
    const f = respuestaDeExcepcion(e);
    return NextResponse.json(f.cuerpo, { status: f.status });
  }
}
