import { NextResponse } from "next/server";
import { requireTenantGastos } from "@/lib/tenant";
import { obtenerSolicitudFondo } from "@/lib/tms/fondos";
import { exportarSolicitudFondoExcel } from "@/lib/tms/gastos-export-excel";

type Ctx = { params: Promise<{ slug: string; id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireTenantGastos(slug, "ver");
  if (guard.error) return guard.error;
  const solicitud = await obtenerSolicitudFondo(guard.empresa.id, Number(id));
  if (!solicitud) return NextResponse.json({ error: "Solicitud no encontrada." }, { status: 404 });
  const buffer = await exportarSolicitudFondoExcel(solicitud);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${solicitud.codigo}.xlsx"`,
      "Cache-Control": "private, no-store",
    },
  });
}
