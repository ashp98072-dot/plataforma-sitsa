import { NextResponse } from "next/server";
import { requireTenantProgramacion } from "@/lib/tenant";
import { METODOS_PAGO_GASTO } from "@/lib/tms/gastos";
import { otrosFondosInstalado, sugerirDestinoPago } from "@/lib/tms/plan-otros-fondos";

type Ctx = { params: Promise<{ slug: string }> };

/**
 * GET ?empleadoId=&metodo= — sugerencia de cuenta bancaria o teléfono desde RRHH para el beneficiario de un «otro fondo del viaje». Solo lectura (nunca modifica RRHH), bajo demanda
 * por empleado (no se expone el catálogo bancario completo) y limitada a la empresa de la sesión. Permiso de editar Programación.
 */
export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantProgramacion(slug, "editar");
  if (guard.error) return guard.error;
  const url = new URL(req.url);
  const empleadoId = Number(url.searchParams.get("empleadoId"));
  const metodo = url.searchParams.get("metodo");
  if (!Number.isInteger(empleadoId) || empleadoId <= 0) return NextResponse.json({ error: "Indica el empleado." }, { status: 400 });
  if (metodo != null && metodo !== "" && !(METODOS_PAGO_GASTO as readonly string[]).includes(metodo)) return NextResponse.json({ error: "Método de pago no válido." }, { status: 400 });
  if (!(await otrosFondosInstalado())) return NextResponse.json({ error: "Otros fondos del viaje aún no está instalado en esta base de datos." }, { status: 409 });
  const r = await sugerirDestinoPago(guard.empresa.id, empleadoId, metodo || null);
  if (!r) return NextResponse.json({ error: "El empleado no pertenece a esta empresa." }, { status: 404 });
  return NextResponse.json(r, { headers: { "Cache-Control": "private, no-store" } });
}
