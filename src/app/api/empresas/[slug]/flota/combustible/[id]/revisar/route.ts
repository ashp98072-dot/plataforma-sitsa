import { NextResponse } from "next/server";
import { requireTenantFlotaCombustible } from "@/lib/tenant";
import { registrarAuditoria } from "@/lib/auditoria";
import { revisarCargaCombustible } from "@/lib/flota/combustible";

type Ctx = { params: Promise<{ slug: string; id: string }> };

/**
 * FLOTA-COMBUSTIBLE-1 (Fase 2) — aprobar/rechazar una carga de
 * combustible PENDIENTE. Guardado por requireTenantFlotaCombustible
 * ("editar") — permiso propio, distinto de "ver" (que solo permite
 * consultar la bandeja).
 */
export async function POST(req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireTenantFlotaCombustible(slug, "editar");
  if (guard.error) return guard.error;

  const cargaId = Number(id);
  if (!cargaId) return NextResponse.json({ error: "ID inválido." }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const accion = body?.accion === "aprobar" || body?.accion === "rechazar" ? body.accion : null;
  if (!accion) {
    return NextResponse.json({ error: "Acción inválida." }, { status: 400 });
  }
  const motivoRechazo = typeof body?.motivo === "string" ? body.motivo : undefined;

  const resultado = await revisarCargaCombustible(
    guard.empresa.id,
    cargaId,
    accion,
    guard.session.username,
    motivoRechazo,
  );
  if (!resultado.ok) {
    return NextResponse.json({ error: resultado.error }, { status: resultado.status });
  }

  await registrarAuditoria({
    empresaId: guard.empresa.id,
    usuario: guard.session.username,
    accion: accion === "aprobar" ? "aprobar_combustible" : "rechazar_combustible",
    modulo: "flota",
    detalle: `Carga de combustible #${cargaId} ${accion === "aprobar" ? "aprobada" : "rechazada"}${motivoRechazo ? `: ${motivoRechazo}` : ""}`,
  });

  return NextResponse.json({
    mensaje: accion === "aprobar" ? "Carga aprobada." : "Carga rechazada.",
  });
}
