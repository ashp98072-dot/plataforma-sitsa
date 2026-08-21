import { NextResponse } from "next/server";
import { requireTenantModulo } from "@/lib/tenant";
import { listarDisponibilidadPersonal } from "@/lib/operaciones/disponibilidad-personal";

type Ctx = { params: Promise<{ slug: string }> };

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET disponibilidad de personal (piloto/auxiliar) para Operaciones →
 * Programación. Mismo patrón que operaciones/disponibilidad (vehículos):
 * endpoint delgado que envuelve listarDisponibilidadPersonal(), sin lógica
 * propia. Misma puerta de acceso que ya usa GET /tms/planes (requireTenantModulo
 * "tms") — quien puede ver los planes puede ver la disponibilidad de quienes
 * los operan.
 */
export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantModulo(slug, "tms");
  if (guard.error) return guard.error;

  const fecha = new URL(req.url).searchParams.get("fecha");
  if (!fecha || !FECHA_RE.test(fecha)) {
    return NextResponse.json(
      { error: "Parámetro 'fecha' inválido (YYYY-MM-DD)." },
      { status: 400 },
    );
  }

  try {
    const personal = await listarDisponibilidadPersonal(guard.empresa.id, fecha);
    return NextResponse.json(
      { personal },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    console.error("disponibilidad-personal", e);
    return NextResponse.json(
      { error: "No se pudo cargar la disponibilidad de personal." },
      { status: 500 },
    );
  }
}
