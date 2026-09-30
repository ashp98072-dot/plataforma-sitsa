import { NextResponse } from "next/server";
import { requireTenantViaticosComprobantes } from "@/lib/tenant";
import { comprobanteAutorizacionesPdf } from "@/lib/tms/viaticos-comprobante-pdf";
import { resolverPeriodoComprobante } from "@/lib/tms/viaticos-comprobante-periodo";

type Ctx = { params: Promise<{ slug: string }> };

const TIPOS_VALIDOS = new Set(["DIA", "SEMANA", "MES"]);

/**
 * VIATICOS-COMPROBANTE-PERIODO — comprobante en PDF, en lote, HISTÓRICO de los viáticos AUTORIZADOS de la empresa
 * DURANTE el período pedido (`?periodo=DIA|SEMANA|MES&valor=...`) — criterio `autorizado_en`, nunca el estado
 * actual (ver viaticos-comprobante-periodo.ts y listarViaticosAutorizadosPorPeriodo en viaticos.ts). Mismo
 * permiso propio y explícito de siempre (viaticos_comprobantes, nunca por defecto en ningún rol) — ver
 * requireTenantViaticosComprobantes; NO se amplía a viaticos/viaticos_autorizar/viaticos_pagar/viaticos_liquidar.
 * empresa_id SIEMPRE sale del guard (guard.empresa.id) — el cliente nunca lo envía ni se confía en él.
 */
export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantViaticosComprobantes(slug, "ver");
  if (guard.error) return guard.error;

  const sp = new URL(req.url).searchParams;
  const tipo = sp.get("periodo") ?? "";
  const valor = sp.get("valor") ?? "";
  if (!TIPOS_VALIDOS.has(tipo)) {
    return NextResponse.json({ error: "Período inválido: debe ser DIA, SEMANA o MES." }, { status: 400 });
  }
  const periodo = resolverPeriodoComprobante(tipo, valor);
  if (!periodo) {
    return NextResponse.json({ error: "Valor de período inválido." }, { status: 400 });
  }

  const buffer = await comprobanteAutorizacionesPdf(guard.empresa.id, guard.empresa.nombre, periodo);
  if (!buffer) {
    return NextResponse.json(
      { error: "No hay viáticos autorizados en el período seleccionado." },
      { status: 404 },
    );
  }

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${periodo.archivo}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
