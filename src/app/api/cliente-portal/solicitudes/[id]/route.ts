import { NextResponse } from "next/server";
import { requireClienteSession } from "@/lib/tms/cliente-portal-guard";
import { obtenerSolicitudCliente } from "@/lib/tms/solicitudes-cliente";

type Ctx = { params: Promise<{ id: string }> };

/**
 * CLIENTE-PORTAL-2 — detalle de UNA solicitud, solo si pertenece al
 * mismo empresaId+clienteId de la sesión. obtenerSolicitudCliente()
 * devuelve null tanto si el id no existe como si es de otro cliente —
 * en ambos casos respondemos 404, nunca 403 (un 403 confirmaría que el
 * id existe, exactamente el tipo de fuga que el ticket pide evitar).
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

  const solicitud = await obtenerSolicitudCliente(
    session.empresaId,
    session.clienteId,
    solicitudId,
  );
  if (!solicitud) {
    return NextResponse.json({ error: "Solicitud no encontrada." }, { status: 404 });
  }
  return NextResponse.json(
    { solicitud },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
