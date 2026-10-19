import { NextResponse } from "next/server";
import { requireTenantFacturacion } from "@/lib/tenant";
import { anularFactura } from "@/lib/facturacion/facturas";

type Ctx = { params: Promise<{ slug: string; id: string }> };

/** Solo si NO tiene pagos registrados — libera sus viajes de inmediato. facturacion:editar. Motivo OPCIONAL (se conserva en la bitácora). */
export async function POST(req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireTenantFacturacion(slug, "anular");
  if (guard.error) return guard.error;

  const facturaId = Number(id);
  if (!Number.isInteger(facturaId) || facturaId <= 0) {
    return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  }

  const cuerpo = (await req.json().catch(() => null)) as { motivo?: unknown } | null;
  const motivo = typeof cuerpo?.motivo === "string" ? cuerpo.motivo : null;

  const resultado = await anularFactura(
    { empresaId: guard.empresa.id, usuarioId: guard.session.id, usuario: guard.session.username },
    facturaId,
    motivo,
  );
  if (!resultado.ok) {
    return NextResponse.json({ error: resultado.error }, { status: resultado.status });
  }
  return NextResponse.json({ mensaje: "Factura anulada. Los viajes quedaron libres para una nueva factura." });
}
