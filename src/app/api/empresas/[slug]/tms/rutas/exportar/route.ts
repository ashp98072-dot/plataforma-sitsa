import { NextResponse } from "next/server";
import { requireTenantRutas } from "@/lib/tenant";
import { listarRutas } from "@/lib/tms/cliente-rutas";
import { exportarRutasExcel } from "@/lib/tms/rutas-export-excel";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantRutas(slug, "ver");
  if (guard.error) return guard.error;
  const rutas = await listarRutas(guard.empresa.id, { incluirInactivas: true });
  const buffer = await exportarRutasExcel(rutas, guard.empresa.nombre);
  const fecha = new Date().toISOString().slice(0, 10);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="rutas-${slug}-${fecha}.xlsx"`,
      "Cache-Control": "private, no-store",
    },
  });
}
