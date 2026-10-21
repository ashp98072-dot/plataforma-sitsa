import { NextResponse } from "next/server";
import { requireTenantFacturacion } from "@/lib/tenant";
import { listarCuentasPorCobrar } from "@/lib/facturacion/cuentas-por-cobrar";
import { filtrosDesdeParams } from "@/lib/facturacion/cuentas-por-cobrar-shared";
import { listarEntidadesEmisoras } from "@/lib/facturacion/contexto-factura";

type Ctx = { params: Promise<{ slug: string }> };

/**
 * M-2a — Cuentas por cobrar INFORMATIVA (Cartera abierta / Historial). SOLO LECTURA: este archivo exporta únicamente GET.
 * Permiso: `facturacion:ver` (el mismo de las facturas); la empresa sale de la sesión, nunca de la query string.
 * Fuente única: fact_facturas + fact_pagos (+ confirmaciones como atributo). `cont_cxc` no participa.
 */
export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantFacturacion(slug, "ver");
  if (guard.error) return guard.error;
  const filtros = filtrosDesdeParams(new URL(req.url).searchParams);
  const [resultado, entidades] = await Promise.all([
    listarCuentasPorCobrar(guard.empresa.id, filtros),
    listarEntidadesEmisoras(guard.empresa.id),
  ]);
  return NextResponse.json({ ...resultado, entidades }, { headers: { "Cache-Control": "private, no-store" } });
}
