import { NextResponse } from "next/server";
import { requireTenantViaticosPagar } from "@/lib/tenant";
import { listarViaticosPorPagar, type EstadoViatico } from "@/lib/tms/viaticos";

type Ctx = { params: Promise<{ slug: string }> };

const ESTADOS: EstadoViatico[] = ["PROGRAMADO", "AUTORIZADO", "ENTREGADO", "LIQUIDADO"];

/**
 * VIAT-2 (punto 3) — bandeja "Viáticos por pagar" del facturador. Permiso
 * EXPLÍCITO `viaticos_pagar:ver` — distinto de `viaticos:ver` (Control de
 * Viáticos general de Operaciones) porque esta lista incluye dato bancario
 * del empleado (banco/cuenta/tipo de cuenta) que no debe verse fuera de
 * quien procesa pagos. Por defecto solo muestra AUTORIZADOS ("mostrar
 * únicamente AUTORIZADOS por defecto") salvo que se pida otro estado
 * explícitamente vía ?estado=.
 */
export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantViaticosPagar(slug, "ver");
  if (guard.error) return guard.error;

  const url = new URL(req.url);
  const planIdRaw = url.searchParams.get("planId");
  const planId = planIdRaw && Number.isFinite(Number(planIdRaw)) ? Number(planIdRaw) : undefined;
  const fechaDesde = url.searchParams.get("fechaDesde") || undefined;
  const fechaHasta = url.searchParams.get("fechaHasta") || undefined;
  const empleadoNombre = url.searchParams.get("empleado") || undefined;
  const estadoRaw = url.searchParams.get("estado");
  const estado: EstadoViatico | undefined =
    estadoRaw === "TODOS"
      ? undefined
      : estadoRaw && (ESTADOS as string[]).includes(estadoRaw)
        ? (estadoRaw as EstadoViatico)
        : "AUTORIZADO";

  const items = await listarViaticosPorPagar(guard.empresa.id, {
    planId,
    fechaDesde,
    fechaHasta,
    empleadoNombre,
    estado,
  });
  return NextResponse.json(
    { items },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
