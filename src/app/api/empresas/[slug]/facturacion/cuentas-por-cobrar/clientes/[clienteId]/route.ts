import { NextResponse } from "next/server";
import { requireTenantFacturacion } from "@/lib/tenant";
import { listarConfirmacionesCliente, listarPagosCliente, resumenCliente } from "@/lib/facturacion/cuentas-por-cobrar";
import { filtrosDesdeParams } from "@/lib/facturacion/cuentas-por-cobrar-shared";

type Ctx = { params: Promise<{ slug: string; clienteId: string }> };

/**
 * M-2a — vista por cliente: resumen POR ENTIDAD + pagos + confirmaciones bancarias (atributo informativo). SOLO LECTURA.
 * Las facturas del cliente se piden a la lista general con `clienteId`.
 */
export async function GET(req: Request, ctx: Ctx) {
  const { slug, clienteId: raw } = await ctx.params;
  const guard = await requireTenantFacturacion(slug, "ver");
  if (guard.error) return guard.error;
  const clienteId = Number(raw);
  if (!Number.isInteger(clienteId) || clienteId <= 0) return NextResponse.json({ error: "Cliente inválido." }, { status: 400 });
  const f = filtrosDesdeParams(new URL(req.url).searchParams, "historial");
  const resumen = await resumenCliente(guard.empresa.id, clienteId, f.entidad);
  if (!resumen) return NextResponse.json({ error: "Cliente no encontrado." }, { status: 404 });
  const [pagos, confirmaciones] = await Promise.all([
    listarPagosCliente(guard.empresa.id, clienteId, { entidad: f.entidad, page: f.page, pageSize: f.pageSize }),
    listarConfirmacionesCliente(guard.empresa.id, clienteId, { entidad: f.entidad, page: f.page, pageSize: f.pageSize }),
  ]);
  return NextResponse.json({ resumen, pagos, confirmaciones }, { headers: { "Cache-Control": "private, no-store" } });
}
