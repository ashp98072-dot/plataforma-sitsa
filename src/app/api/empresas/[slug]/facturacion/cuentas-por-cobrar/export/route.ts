import { NextResponse } from "next/server";
import { requireTenantFacturacion } from "@/lib/tenant";
import { listarParaExportar } from "@/lib/facturacion/cuentas-por-cobrar";
import { cuentasPorCobrarAExcel } from "@/lib/facturacion/cuentas-por-cobrar-excel";
import { filtrosDesdeParams } from "@/lib/facturacion/cuentas-por-cobrar-shared";

type Ctx = { params: Promise<{ slug: string }> };

/** M-2a — Excel del conjunto FILTRADO exacto (sin paginar). SOLO LECTURA (`facturacion:ver`). */
export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantFacturacion(slug, "ver");
  if (guard.error) return guard.error;
  const filtros = filtrosDesdeParams(new URL(req.url).searchParams);
  const r = await listarParaExportar(guard.empresa.id, filtros);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  const buffer = await cuentasPorCobrarAExcel(r.filas);
  const nombre = filtros.vista === "cartera" ? "cartera-abierta" : "historial-facturas";
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="cuentas-por-cobrar-informativa-${nombre}.xlsx"`,
      "Cache-Control": "private, no-store",
    },
  });
}
