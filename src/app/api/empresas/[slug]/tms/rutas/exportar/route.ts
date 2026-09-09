import { NextResponse } from "next/server";
import { requireTenantRutas } from "@/lib/tenant";
import { listarRutas } from "@/lib/tms/cliente-rutas";
import { exportarRutasExcel } from "@/lib/tms/rutas-export-excel";

type Ctx = { params: Promise<{ slug: string }> };

/**
 * RUTAS-TARIFARIO-HISTORIAL-1 (§6 del ticket) — el mismo export ya
 * existente, ahora también filtrable por cliente/código/nombre-o-
 * descripción/estado (mismos filtros que ya usa la búsqueda de la
 * pantalla, listarRutas — sin duplicar lógica de filtrado). Sin
 * querystring, se comporta EXACTO igual que antes: exporta todas
 * (activas e inactivas).
 */
export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantRutas(slug, "ver");
  if (guard.error) return guard.error;

  const url = new URL(req.url);
  const clienteIdRaw = url.searchParams.get("clienteId");
  const clienteId = clienteIdRaw && Number.isFinite(Number(clienteIdRaw)) ? Number(clienteIdRaw) : undefined;
  const codigo = url.searchParams.get("codigo") || undefined;
  const q = url.searchParams.get("q") || undefined;
  const estado = url.searchParams.get("estado"); // "Activa" | "Inactiva" | ausente = todas

  const rutas = await listarRutas(guard.empresa.id, {
    clienteId,
    codigo,
    q,
    incluirInactivas: true,
    activo: estado === "Activa" ? true : estado === "Inactiva" ? false : undefined,
  });
  const buffer = await exportarRutasExcel(rutas, guard.empresa.nombre);
  const fecha = new Date().toISOString().slice(0, 10);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="rutas-${slug}-${fecha}.xlsx"`,
      "Cache-Control": "private, no-store",
    },
  });
}
