import { NextResponse } from "next/server";
import { requireTenantFacturacion } from "@/lib/tenant";
import { listarBitacoraFactura } from "@/lib/facturacion/bitacora";

type Ctx = { params: Promise<{ slug: string; id: string }> };

/** Historial de UNA factura. Solo lectura. Permiso PROPIO `facturacion:ver_bitacora` (ver facturas no basta). La empresa sale de la sesión. */
export async function GET(_req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireTenantFacturacion(slug, "ver_bitacora");
  if (guard.error) return guard.error;
  const facturaId = Number(id);
  if (!Number.isInteger(facturaId) || facturaId <= 0) return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  try {
    const eventos = await listarBitacoraFactura(guard.empresa.id, facturaId);
    return NextResponse.json({ eventos }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "No se pudo consultar la bitácora." }, { status: 500 });
  }
}
