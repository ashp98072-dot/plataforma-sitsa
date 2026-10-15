import { NextResponse } from "next/server";
import { requireTenantFacturacion } from "@/lib/tenant";
import { listarClientesCxc } from "@/lib/facturacion/cuentas-por-cobrar";
import { filtrosDesdeParams } from "@/lib/facturacion/cuentas-por-cobrar-shared";

type Ctx = { params: Promise<{ slug: string }> };

/** M-2a — índice de clientes con saldo informativo (una fila por cliente × entidad). SOLO LECTURA (`facturacion:ver`). */
export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantFacturacion(slug, "ver");
  if (guard.error) return guard.error;
  const f = filtrosDesdeParams(new URL(req.url).searchParams, "historial");
  const r = await listarClientesCxc(guard.empresa.id, {
    entidad: f.entidad,
    textoCliente: f.textoCliente,
    page: f.page,
    pageSize: f.pageSize,
  });
  return NextResponse.json(r, { headers: { "Cache-Control": "private, no-store" } });
}
