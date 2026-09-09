import { NextResponse } from "next/server";
import { requireTenantGastos } from "@/lib/tenant";
import {
  TIPOS_REPORTE_GASTOS,
  filtrosReporteGastosDesdeUrl,
  obtenerReporteGastosPorTipo,
  type TipoReporteGastos,
} from "@/lib/tms/reportes-gastos";
import {
  exportarAgregadoGastosExcel,
  exportarRentabilidadExcel,
  exportarReporteFondosExcel,
  exportarViaticosReporteExcel,
} from "@/lib/tms/gastos-export-excel";

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
  // Mismo criterio de filtros/consulta que el GET de solo lectura — nunca dos parseos que puedan divergir.
  const resultado = await obtenerReporteGastosPorTipo(guard.empresa.id, tipo as TipoReporteGastos, filtrosReporteGastosDesdeUrl(url));

  const buffer = await (resultado.tipo === "viaticos"
    ? exportarViaticosReporteExcel(resultado.filas)
    : resultado.tipo === "rentabilidad"
      ? exportarRentabilidadExcel(resultado.filas)
      : resultado.tipo === "fondos"
        ? exportarReporteFondosExcel(resultado.filas)
        : exportarAgregadoGastosExcel(`Gastos por ${resultado.tipo}`, resultado.etiqueta, resultado.filas));

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="reporte-gastos-${tipo}.xlsx"`,
      "Cache-Control": "private, no-store",
    },
  });
}
