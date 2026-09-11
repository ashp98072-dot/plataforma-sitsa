import { NextResponse } from "next/server";
import { requireTenantGastos } from "@/lib/tenant";
import { generarPdfGastoAutorizado } from "@/lib/tms/gastos-individual-pdf";

type Ctx = { params: Promise<{ slug: string; id: string }> };

/**
 * GASTOS-ADMINISTRATIVO-1 (Fase 5) — PDF individual (encabezado, una fila
 * de detalle, total y 3 firmas) de UN gasto operativo. Mismo guard que el
 * resto de lectura de Gastos (`requireTenantGastos`, "ver") — no el de
 * autorizar, igual que `fondos/[id]/pdf/route.ts`. Solo disponible
 * `estado === "Autorizada"` (ver generarPdfGastoAutorizado) — Pendiente,
 * Rechazada e históricos devuelven 400 con un mensaje claro, nunca un PDF
 * "autorizado" a medias.
 */
export async function GET(_req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireTenantGastos(slug, "ver");
  if (guard.error) return guard.error;

  const resultado = await generarPdfGastoAutorizado(guard.empresa.id, Number(id), guard.empresa.nombre);
  if (!resultado.ok) {
    return NextResponse.json({ error: resultado.error }, { status: resultado.status });
  }
  return new NextResponse(new Uint8Array(resultado.buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${resultado.nombreArchivo}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
