import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantViajesConfirmarReporte } from "@/lib/tenant";
import { confirmarReporteOperativo } from "@/lib/tms/liquidacion-viaje-reporte";
import { respuestaDeExcepcion } from "@/lib/validacion-formulario";

type Ctx = { params: Promise<{ slug: string; id: string }> };

/** Esquema ESTRICTO: la empresa y el usuario salen SIEMPRE de la sesión; el cliente no puede enviarlos. */
const bodySchema = z
  .object({
    observacion: z.string().max(500).optional(),
    reconocerAdvertencias: z.boolean().optional(),
  })
  .strict();

/**
 * LIQUIDACIÓN DE VIAJES, FASE 2 — confirmar que el piloto entregó su reporte (`REPORTE_RECIBIDO`).
 *
 * Permiso EXPLÍCITO `viajes_confirmar_reporte:editar` (requireTenantViajesConfirmarReporte), nunca por rol. Es una
 * confirmación HUMANA: NO cierra, NO liquida, NO cambia el estado del viaje y NO equivale a llegada. Si el piloto no tiene
 * salida/llegada registrada responde 409 con `codigo: "ADVERTENCIAS"` y NO escribe nada; reenviar con
 * `reconocerAdvertencias: true` confirma y deja las advertencias reconocidas en el evento. Idempotente: confirmar un viaje ya
 * en REPORTE_RECIBIDO devuelve la liquidación existente sin evento nuevo.
 */
export async function POST(req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireTenantViajesConfirmarReporte(slug, "editar");
  if (guard.error) return guard.error;

  const planId = Number(id);
  if (!Number.isInteger(planId) || planId <= 0) {
    return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  }
  const raw = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(raw ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: "Solicitud inválida." }, { status: 400 });
  }

  try {
    const r = await confirmarReporteOperativo(
      { empresaId: guard.empresa.id, usuarioId: guard.session.id, usuario: guard.session.username },
      { planId, observacion: parsed.data.observacion ?? null, reconocerAdvertencias: parsed.data.reconocerAdvertencias === true },
    );
    if (!r.ok) {
      return NextResponse.json(
        { error: "Hay advertencias que debes reconocer para confirmar el reporte.", codigo: "ADVERTENCIAS", advertencias: r.advertencias },
        { status: 409 },
      );
    }
    const { liquidacion, idempotente } = r.resultado;
    return NextResponse.json({
      mensaje: idempotente ? "El reporte ya estaba confirmado." : "Reporte recibido confirmado.",
      idempotente,
      liquidacion: { estado: liquidacion.estado, version: liquidacion.version },
    });
  } catch (e) {
    const f = respuestaDeExcepcion(e);
    return NextResponse.json(f.cuerpo, { status: f.status });
  }
}
