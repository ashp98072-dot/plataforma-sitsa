import { NextResponse } from "next/server";
import { requireTenantViaticosComprobantes } from "@/lib/tenant";
import { comprobanteAutorizacionesPdf } from "@/lib/tms/viaticos-comprobante-pdf";
import { hoyLocal } from "@/lib/rrhh/dates";

type Ctx = { params: Promise<{ slug: string }> };

/**
 * VIATICOS-COMPROBANTE-PDF — comprobante en PDF, en lote, de todos los
 * viáticos actualmente AUTORIZADOS de la empresa (uno por firma de
 * autorización). Permiso propio y explícito (viaticos_comprobantes,
 * nunca por defecto en ningún rol) — ver requireTenantViaticosComprobantes.
 */
export async function GET(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantViaticosComprobantes(slug, "ver");
  if (guard.error) return guard.error;

  const buffer = await comprobanteAutorizacionesPdf(guard.empresa.id, guard.empresa.nombre);
  if (!buffer) {
    return NextResponse.json(
      { error: "No hay viáticos autorizados actualmente para generar el comprobante." },
      { status: 404 },
    );
  }

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="viaticos-autorizados-${hoyLocal()}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
