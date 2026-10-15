import { NextResponse } from "next/server";
import { requireTenantGastos, requireTenantProgramacionOTms } from "@/lib/tenant";
import { obtenerResumenLiquidacionViaje } from "@/lib/tms/resumen-liquidacion";
import { respuestaDeExcepcion } from "@/lib/validacion-formulario";

type Ctx = { params: Promise<{ slug: string; id: string }> };

/**
 * TMS, FASE 5 — RESUMEN COMERCIAL DE LIQUIDACIÓN de un viaje. SOLO LECTURA.
 *
 * Visibilidad de la parte comercial (tarifa base, cargos, subtotal, estado de liquidación): la misma que el listado de viajes
 * (programacion:ver o tms:ver). La empresa sale de la sesión; un viaje de otra empresa es 404.
 *
 * Costos internos (gastos/anticipos): SOLO si el usuario tiene permiso de lectura de Gastos (`requireTenantGastos`, el mismo que
 * protege Gastos y Fondos). Sin ese permiso el servicio ni consulta esas tablas y la respuesta lleva `costos: null` — el filtrado
 * es del backend, no de la UI.
 *
 * No calcula IVA, no factura, no genera asientos y no escribe nada.
 */
export async function GET(_req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireTenantProgramacionOTms(slug, "ver");
  if (guard.error) return guard.error;
  const planId = Number(id);
  if (!Number.isInteger(planId) || planId <= 0) return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  try {
    const gastos = await requireTenantGastos(slug, "ver");
    const incluirCostos = !gastos.error;
    const resumen = await obtenerResumenLiquidacionViaje(guard.empresa.id, planId, { incluirCostos });
    if (!resumen) return NextResponse.json({ error: "Viaje no encontrado." }, { status: 404 });
    return NextResponse.json(resumen);
  } catch (e) {
    const f = respuestaDeExcepcion(e);
    return NextResponse.json(f.cuerpo, { status: f.status });
  }
}
