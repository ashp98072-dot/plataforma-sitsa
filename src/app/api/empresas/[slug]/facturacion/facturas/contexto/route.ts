import { NextResponse } from "next/server";
import { requireTenantFacturacion } from "@/lib/tenant";
import {
  fact4Disponible,
  leerRetencionIvaCliente,
  listarCuentasBancarias,
  listarEntidadesEmisoras,
} from "@/lib/facturacion/contexto-factura";
import { RETENCIONES_IVA_PERMITIDAS } from "@/lib/facturacion/lineas-factura";

type Ctx = { params: Promise<{ slug: string }> };

/**
 * FACT-4 — contexto para PREPARAR una factura: entidades emisoras, cuentas bancarias, retención de IVA configurada del cliente
 * y si el usuario puede cambiarla. Solo lectura; permiso de crear (`facturacion:crear`) o de editar el borrador. Nada de esto
 * expone números de cuenta contable.
 */
export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  // Sirve tanto a quien crea un borrador como a quien edita uno existente.
  const porCrear = await requireTenantFacturacion(slug, "crear");
  const guard = porCrear.error ? await requireTenantFacturacion(slug, "editar") : porCrear;
  if (guard.error) return porCrear.error ?? guard.error;

  const clienteId = Number(new URL(req.url).searchParams.get("clienteId"));
  if (!Number.isInteger(clienteId) || clienteId <= 0) {
    return NextResponse.json({ error: "clienteId inválido." }, { status: 400 });
  }

  const disponible = await fact4Disponible();
  if (!disponible) {
    return NextResponse.json(
      { fact4Disponible: false, entidades: [], cuentasBancarias: [], retencionIvaClientePct: 0, puedeCambiarRetencion: false, retencionesPermitidas: RETENCIONES_IVA_PERMITIDAS },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const [entidades, cuentasBancarias, retencionIvaClientePct, permisoRetencion] = await Promise.all([
    listarEntidadesEmisoras(guard.empresa.id),
    listarCuentasBancarias(guard.empresa.id),
    leerRetencionIvaCliente(guard.empresa.id, clienteId),
    requireTenantFacturacion(slug, "editar_requisitos"),
  ]);
  return NextResponse.json(
    {
      fact4Disponible: true,
      entidades,
      cuentasBancarias,
      retencionIvaClientePct,
      puedeCambiarRetencion: !permisoRetencion.error,
      retencionesPermitidas: RETENCIONES_IVA_PERMITIDAS,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
