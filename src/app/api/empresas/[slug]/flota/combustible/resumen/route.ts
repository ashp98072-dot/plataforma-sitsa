import { resumenIntegrado } from "@/lib/flota/cb2/resumen-mensual";
import { NextResponse } from "next/server";
import { requireTenantFlotaCombustible } from "@/lib/tenant";

import { resumenCombustibleMensual } from "@/lib/flota/combustible";
import { hoyLocal } from "@/lib/rrhh/dates";
import { rangoMes } from "@/lib/rrhh/resumen-mensual";
import { codigoSeguroResumen } from "@/lib/flota/cb2/resumen-error";

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
  const mes = mesRaw === null ? hoyLocal().slice(0, 7) : mesRaw;
  try {
    rangoMes(mes);
    // El límite exclusivo debe poder representarse como DATE en MariaDB.
    if (mes === "9999-12") throw new Error("Mes fuera de rango");
  } catch {
    return NextResponse.json({ error: "Mes inválido. Usa AAAA-MM desde 2000-01 hasta 9999-11." }, { status: 400, headers: { "Cache-Control": "private, no-store" } });
  }

  let etapa: "historico" | "integrado" = "historico";
  const inicio = Date.now();
  try {
    const resumen = await resumenCombustibleMensual(guard.empresa.id, mes);
    etapa = "integrado";
    return NextResponse.json({ mes, ...resumen, integrado: await resumenIntegrado(guard.empresa.id, mes) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("[combustible-resumen]", { etapa, codigo: codigoSeguroResumen(error), duracionMs: Date.now() - inicio });
    return NextResponse.json({ error: "No se pudo cargar el resumen completo. Vuelve a intentar o contacta a soporte." }, { status: 500, headers: { "Cache-Control": "private, no-store" } });
  }
}
