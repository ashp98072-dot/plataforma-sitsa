import { NextResponse } from "next/server";
import { requireTenantProgramacionOTms } from "@/lib/tenant";
import { listarSolicitudesClienteInterno } from "@/lib/tms/solicitudes-cliente-operaciones";

/**
 * CLIENTE-PORTAL-3 — bandeja interna de solicitudes de clientes
 * (Operaciones). Mismo guard de lectura que ya usa GET /tms/planes
 * (programacion:ver O tms:ver) — este listado alimenta la misma
 * pantalla de trabajo de Programación/TMS, no un módulo aparte.
 * Scoped SOLO por empresa (el staff ve las solicitudes de todos sus
 * clientes) — nunca por clienteId de sesión, porque esto NO es el
 * Portal del Cliente.
 */
export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const guard = await requireTenantProgramacionOTms(slug);
  if (guard.error) return guard.error;

  const url = new URL(req.url);
  const estado = url.searchParams.get("estado") || undefined;
  const clienteIdRaw = url.searchParams.get("clienteId");
  const clienteId = clienteIdRaw ? Number(clienteIdRaw) : undefined;
  const fechaDesde = url.searchParams.get("fechaDesde") || undefined;
  const fechaHasta = url.searchParams.get("fechaHasta") || undefined;

  const solicitudes = await listarSolicitudesClienteInterno(guard.empresa.id, {
    estado,
    clienteId: clienteId && Number.isFinite(clienteId) ? clienteId : undefined,
    fechaDesde,
    fechaHasta,
  });
  return NextResponse.json(
    { solicitudes },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
