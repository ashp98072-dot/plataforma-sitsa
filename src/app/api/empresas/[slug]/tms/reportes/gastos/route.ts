import { NextResponse } from "next/server";
import { requireTenantGastos } from "@/lib/tenant";
import {
  TIPOS_REPORTE_GASTOS,
  filtrosReporteGastosDesdeUrl,
  mensajeCategoriaFondosInvalida,
  obtenerReporteGastosPorTipo,
  type TipoReporteGastos,
} from "@/lib/tms/reportes-gastos";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantGastos(slug, "ver");
  if (guard.error) return guard.error;

  const url = new URL(req.url);
  const tipo = url.searchParams.get("tipo");
  if (!tipo || !(TIPOS_REPORTE_GASTOS as readonly string[]).includes(tipo)) {
    return NextResponse.json({ error: `Tipo de reporte inválido. Usa uno de: ${TIPOS_REPORTE_GASTOS.join(", ")}.` }, { status: 400 });
  }
  const filtros = filtrosReporteGastosDesdeUrl(url);
  // OP-FONDOS-REP-01 — categoría del reporte de fondos validada contra el catálogo real; nunca se degrada a búsqueda general.
  const errorCategoria = mensajeCategoriaFondosInvalida(tipo, filtros.categoria);
  if (errorCategoria) return NextResponse.json({ error: errorCategoria, codigo: "FILTRO_INVALIDO" }, { status: 400, headers: { "Cache-Control": "private, no-store" } });
  const resultado = await obtenerReporteGastosPorTipo(guard.empresa.id, tipo as TipoReporteGastos, filtros);
  return NextResponse.json(resultado, { headers: { "Cache-Control": "private, no-store" } });
}
