import { resumenIntegrado } from "@/lib/flota/cb2/resumen-mensual";
import { NextResponse } from "next/server";
import { requireTenantFlotaCombustible } from "@/lib/tenant";

import { resumenCombustibleMensual } from "@/lib/flota/combustible";
import { hoyLocal } from "@/lib/rrhh/dates";

/**
 * FLOTA-COMBUSTIBLE-1 (Fase 3) — "un total de cuánto se echó de diesel o
 * gasolina al mes" (pedido original del usuario). Totales por vehículo y
 * consolidado del mes, solo cargas APROBADO (ver resumenCombustibleMensual).
 * Mismo permiso que la bandeja de revisión (requireTenantFlotaCombustible,
 * "ver") — es un reporte de lectura, no requiere el permiso de "editar"
 * que sí exige aprobar/rechazar.
 */
export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const guard = await requireTenantFlotaCombustible(slug, "ver");
  if (guard.error) return guard.error;


  const url = new URL(req.url);
  const mesRaw = url.searchParams.get("mes");
  const mes = mesRaw && /^\d{4}-(0[1-9]|1[0-2])$/.test(mesRaw) ? mesRaw : hoyLocal().slice(0, 7);

  try {
    const resumen = await resumenCombustibleMensual(guard.empresa.id, mes);
    return NextResponse.json({ mes, ...resumen, integrado: await resumenIntegrado(guard.empresa.id, mes) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "No se pudo cargar el resumen completo. Verifica la migración PR514 y vuelve a intentar." }, { status: 500, headers: { "Cache-Control": "private, no-store" } });
  }
}
