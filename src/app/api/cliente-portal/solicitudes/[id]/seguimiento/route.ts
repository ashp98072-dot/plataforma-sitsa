import { NextResponse } from "next/server";
import { requireClienteSession } from "@/lib/tms/cliente-portal-guard";
import { obtenerSeguimientoSolicitudCliente } from "@/lib/tms/cliente-portal-seguimiento";

type Ctx = { params: Promise<{ id: string }> };

/**
 * CLIENTE-PORTAL-4 — seguimiento de una solicitud (y, si ya fue
 * programada, del plan/viaje real). Cadena de autorización completa
 * (empresaId+clienteId de sesión -> solicitud -> plan) dentro de
 * obtenerSeguimientoSolicitudCliente(); nunca acepta un planId del
 * navegador. `null` (solicitud ajena, o plan que no coincide en
 * empresa/cliente) -> 404, nunca 403.
 */
export async function GET(_req: Request, ctx: Ctx) {
  const guard = await requireClienteSession();
  if (guard.error) return guard.error;
  const { session } = guard;

  const { id } = await ctx.params;
  const solicitudId = Number(id);
  if (!Number.isFinite(solicitudId) || solicitudId <= 0) {
    return NextResponse.json({ error: "Solicitud no encontrada." }, { status: 404 });
  }

  const seguimiento = await obtenerSeguimientoSolicitudCliente(
    session.empresaId,
    session.clienteId,
    solicitudId,
  );
  if (!seguimiento) {
    return NextResponse.json({ error: "Solicitud no encontrada." }, { status: 404 });
  }
  return NextResponse.json(
    { seguimiento },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
