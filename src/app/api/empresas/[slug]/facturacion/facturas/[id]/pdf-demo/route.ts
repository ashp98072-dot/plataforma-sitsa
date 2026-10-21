import { NextResponse } from "next/server";
import { requireTenantFacturacion } from "@/lib/tenant";
import { generarPdfFacturaDemo } from "@/lib/facturacion/factura-demo-pdf";

type Ctx = { params: Promise<{ slug: string; id: string }> };

/**
 * PDF DEMO (NO FISCAL) de una factura de Facturación, para validar el formato visual. Solo lectura: mismo permiso que
 * ver una factura (`facturacion:ver`). La empresa sale SIEMPRE del guard (nunca del cliente) y la factura se busca con
 * ese empresa_id: la de otra empresa responde 404. Disponible para Borrador y Emitida; una Anulada o una anterior al
 * desglose por línea responde 409 con el motivo. Ver src/lib/facturacion/factura-demo-pdf.ts.
 */
export async function GET(_req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireTenantFacturacion(slug, "ver");
  if (guard.error) return guard.error;

  const facturaId = Number(id);
  if (!Number.isInteger(facturaId) || facturaId <= 0) {
    return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  }

  const resultado = await generarPdfFacturaDemo(
    { id: guard.empresa.id, nombre: guard.empresa.nombre, logoUrl: guard.empresa.logoUrl },
    facturaId,
  );
  if (!resultado.ok) {
    return NextResponse.json({ error: resultado.error }, { status: resultado.status });
  }
  return new NextResponse(new Uint8Array(resultado.buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${resultado.nombreArchivo}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
