import { NextResponse } from "next/server";
import { requireTenantProgramacionOTms } from "@/lib/tenant";
import { listarCerradosPendientesLiquidacion } from "@/lib/tms/cargos-adicionales";
import { respuestaDeExcepcion } from "@/lib/validacion-formulario";

type Ctx = { params: Promise<{ slug: string }> };

/**
 * LIQUIDACIÓN DE VIAJES, FASE 4 — vista «Cerrados pendientes de liquidación» de Ajustes rápidos: viajes `Cerrado` con liquidación
 * `REPORTE_RECIBIDO` o `EN_AJUSTE` (y, opcionalmente con `?incluirLiquidados=1`, los `LIQUIDADO` de los últimos 30 días, con cargos
 * bloqueados). Acotada (máx. 200 filas) y por empresa de la sesión; NO devuelve el histórico Cerrado ni altera la lista normal de
 * Programación. Solo lectura; misma visibilidad que el listado de viajes.
 */
export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantProgramacionOTms(slug, "ver");
  if (guard.error) return guard.error;
  const incluirLiquidados = new URL(req.url).searchParams.get("incluirLiquidados") === "1";
  try {
    return NextResponse.json(await listarCerradosPendientesLiquidacion(guard.empresa.id, { incluirLiquidados }));
  } catch (e) {
    const f = respuestaDeExcepcion(e);
    return NextResponse.json(f.cuerpo, { status: f.status });
  }
}
