import { NextResponse } from "next/server";
import { requireTenantGastos } from "@/lib/tenant";
import { obtenerGasto } from "@/lib/tms/gastos";
import { exportarGastoOperativoExcel } from "@/lib/tms/gastos-export-excel";

type Ctx = { params: Promise<{ slug: string; id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireTenantGastos(slug, "ver");
  if (guard.error) return guard.error;
  const gasto = await obtenerGasto(guard.empresa.id, Number(id));
  if (!gasto) return NextResponse.json({ error: "Gasto no encontrado." }, { status: 404 });
  const buffer = await exportarGastoOperativoExcel(gasto);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="gasto-${gasto.id}.xlsx"`,
      "Cache-Control": "private, no-store",
    },
  });
}
