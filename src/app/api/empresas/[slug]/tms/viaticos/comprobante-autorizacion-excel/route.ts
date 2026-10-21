import { NextResponse } from "next/server";
import { requireTenantViaticosComprobantes } from "@/lib/tenant";
import { comprobanteAutorizacionesExcel } from "@/lib/tms/viaticos-comprobante-excel";
import { resolverPeriodoComprobante } from "@/lib/tms/viaticos-comprobante-periodo";

type Ctx = { params: Promise<{ slug: string }> };

const TIPOS_VALIDOS = new Set(["DIA", "SEMANA", "MES"]);

/**
 * VIATICOS-COMPROBANTE-ADMIN-1 — equivalente Excel de .../comprobante-autorizacion-pdf/route.ts: mismo
 * contrato exacto (parámetros, permiso, códigos de estado, criterio histórico `autorizado_en`) — único cambio
 * real es el formato de salida y el nombre de archivo (`periodo.archivoExcel` en vez de `periodo.archivo`).
 * Mismo permiso propio y explícito (viaticos_comprobantes, nunca por defecto en ningún rol) — ver
 * requireTenantViaticosComprobantes; NO se amplía a viaticos_pagar (este comprobante no incluye datos
 * bancarios, ver viaticos-comprobante-filas.ts). empresa_id SIEMPRE sale del guard (guard.empresa.id).
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

  const buffer = await comprobanteAutorizacionesExcel(guard.empresa.id, guard.empresa.nombre, periodo);
  if (!buffer) {
    return NextResponse.json(
      { error: "No hay viáticos autorizados en el período seleccionado." },
      { status: 404 },
    );
  }

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${periodo.archivoExcel}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
