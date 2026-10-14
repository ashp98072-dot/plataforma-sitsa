import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantViajesReabrirLiquidacion } from "@/lib/tenant";
import { reabrirLiquidacion } from "@/lib/tms/liquidacion-viaje";
import { respuestaDeExcepcion } from "@/lib/validacion-formulario";

type Ctx = { params: Promise<{ slug: string; id: string }> };

/** Esquema ESTRICTO: empresa y usuario salen de la sesión; `expectedVersion` y `motivo` son obligatorios. */
const bodySchema = z
  .object({
    expectedVersion: z.number().int().min(1).max(2147483647),
    motivo: z.string().max(500),
  })
  .strict();

/**
 * LIQUIDACIÓN DE VIAJES, FASE 3 — reabrir una liquidación (`LIQUIDADO → EN_AJUSTE`) con motivo obligatorio (≥ 5 caracteres).
 *
 * Permiso EXPLÍCITO `viajes_reabrir_liquidacion:editar`, separado de `viajes_liquidar`. La liquidación anterior permanece en el
 * historial append-only; después debe liquidarse de nuevo. Un viaje Cerrado conserva su cierre (la liquidación entra en ajuste y el
 * viaje NO se reabre); solo Cancelado no admite la reapertura. NO cierra, NO factura, NO crea cargos y NO mueve fondos/gastos.
 */
export async function POST(req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireTenantViajesReabrirLiquidacion(slug, "editar");
  if (guard.error) return guard.error;

  const planId = Number(id);
  if (!Number.isInteger(planId) || planId <= 0) {
    return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  }
  const raw = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Solicitud inválida: se requieren expectedVersion y motivo." }, { status: 400 });
  }

  try {
    const r = await reabrirLiquidacion(
      { empresaId: guard.empresa.id, usuarioId: guard.session.id, usuario: guard.session.username },
      { planId, versionEsperada: parsed.data.expectedVersion, motivo: parsed.data.motivo },
    );
    return NextResponse.json({
      mensaje: r.idempotente ? "La liquidación ya estaba reabierta." : "Liquidación reabierta: el viaje quedó en ajuste.",
      idempotente: r.idempotente,
      evento: r.evento,
      liquidacion: { estado: r.liquidacion.estado, version: r.liquidacion.version },
    });
  } catch (e) {
    const f = respuestaDeExcepcion(e);
    return NextResponse.json(f.cuerpo, { status: f.status });
  }
}
