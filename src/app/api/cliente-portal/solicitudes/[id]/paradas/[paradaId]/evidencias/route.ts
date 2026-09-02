import { NextResponse } from "next/server";
import { requireClienteSession } from "@/lib/tms/cliente-portal-guard";
import { obtenerEvidenciasParadaCliente } from "@/lib/tms/cliente-portal-seguimiento";

type Ctx = { params: Promise<{ id: string; paradaId: string }> };

/**
 * CLIENTE-PORTAL-4 — evidencias de UNA parada de un plan ya autorizado.
 * Nunca expone la ruta real del archivo — solo id/tipo/fecha/nombre;
 * el archivo se pide aparte a la ruta .../[evidenciaId]/archivo, que
 * revalida TODA la cadena de nuevo.
 */
export async function GET(_req: Request, ctx: Ctx) {
  const guard = await requireClienteSession();
  if (guard.error) return guard.error;
  const { session } = guard;

  const { id, paradaId } = await ctx.params;
  const solicitudId = Number(id);
  const paradaIdNum = Number(paradaId);
  if (!Number.isFinite(solicitudId) || !Number.isFinite(paradaIdNum)) {
    return NextResponse.json({ error: "Parada no encontrada." }, { status: 404 });
  }

  const evidencias = await obtenerEvidenciasParadaCliente(
    session.empresaId,
    session.clienteId,
    solicitudId,
    paradaIdNum,
  );
  if (!evidencias) {
    return NextResponse.json({ error: "Parada no encontrada." }, { status: 404 });
  }
  return NextResponse.json(
    { evidencias },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
