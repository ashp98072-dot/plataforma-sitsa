import { NextResponse } from "next/server";
import { requireTenantFacturacion } from "@/lib/tenant";
import { ErrorAntiguedad, listarAntiguedadParaExportar } from "@/lib/facturacion/antiguedad-cxc";
import { antiguedadAExcel } from "@/lib/facturacion/antiguedad-cxc-excel";
import { filtrosAntiguedadDesdeParams } from "@/lib/facturacion/antiguedad-cxc-shared";

type Ctx = { params: Promise<{ slug: string }> };

/** MIL-CXC-ANT-01 — Excel del conjunto FILTRADO exacto (sin paginar). SOLO LECTURA (`facturacion:ver`). */
export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantFacturacion(slug, "ver");
  if (guard.error) return guard.error;
  const filtros = filtrosAntiguedadDesdeParams(new URL(req.url).searchParams);
  try {
    const r = await listarAntiguedadParaExportar(guard.empresa.id, filtros);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
    const buffer = await antiguedadAExcel(r.filas, r.totales, r.totalesPorMoneda, r.fechaCorte);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="cuentas-por-cobrar-antiguedad-${r.fechaCorte}.xlsx"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    if (e instanceof ErrorAntiguedad) return NextResponse.json({ error: e.message, codigo: e.codigo }, { status: e.status });
    console.error("[cxc-antiguedad-export]", { code: (e as { code?: string })?.code ?? "desconocido" });
    return NextResponse.json({ error: "No se pudo generar el reporte. Intenta nuevamente." }, { status: 500 });
  }
}
