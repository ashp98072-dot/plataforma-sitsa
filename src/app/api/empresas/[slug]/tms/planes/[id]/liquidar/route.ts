import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantViajesLiquidar } from "@/lib/tenant";
import { liquidarViaje } from "@/lib/tms/liquidacion-viaje";
import { respuestaDeExcepcion } from "@/lib/validacion-formulario";

type Ctx = { params: Promise<{ slug: string; id: string }> };

/** Esquema ESTRICTO: la empresa y el usuario salen SIEMPRE de la sesión; `expectedVersion` es obligatorio. */
const bodySchema = z
  .object({
    expectedVersion: z.number().int().min(1).max(2147483647),
    observacion: z.string().max(500).optional(),
  })
  .strict();

/**
 * LIQUIDACIÓN DE VIAJES, FASE 3 — liquidar (`REPORTE_RECIBIDO → LIQUIDADO`) o liquidar nuevamente (`EN_AJUSTE → LIQUIDADO`).
 *
 * Permiso EXPLÍCITO `viajes_liquidar:editar` (requireTenantViajesLiquidar), nunca por rol y distinto de `viajes_cerrar` y de
 * `viajes_confirmar_reporte`. SECUENCIA: solo un viaje CERRADO puede liquidarse (409 `PLAN_NO_CERRADO` si sigue abierto); el
 * servidor lo valida bajo el lock del plan. NO cierra el viaje, NO factura, NO crea cargos y NO mueve fondos/gastos. Guarda en el evento una
 * fotografía operativa inmutable. Concurrencia: `expectedVersion` (409 si cambió). Réplica segura solo donde el dominio la
 * define (mismo actor, versión + 1): responde 200 con `idempotente: true` y sin evento nuevo.
 */
export async function POST(req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireTenantViajesLiquidar(slug, "editar");
  if (guard.error) return guard.error;

  const planId = Number(id);
  if (!Number.isInteger(planId) || planId <= 0) {
    return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  }
  const raw = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Solicitud inválida: falta expectedVersion o hay campos no permitidos." }, { status: 400 });
  }

  try {
    const r = await liquidarViaje(
      { empresaId: guard.empresa.id, usuarioId: guard.session.id, usuario: guard.session.username },
      { planId, versionEsperada: parsed.data.expectedVersion, observacion: parsed.data.observacion ?? null },
    );
    return NextResponse.json({
      mensaje: r.idempotente
        ? "El viaje ya estaba liquidado."
        : r.evento === "RELIQUIDADO" ? "Viaje liquidado nuevamente." : "Viaje liquidado.",
      idempotente: r.idempotente,
      evento: r.evento,
      liquidacion: { estado: r.liquidacion.estado, version: r.liquidacion.version },
    });
  } catch (e) {
    const f = respuestaDeExcepcion(e);
    return NextResponse.json(f.cuerpo, { status: f.status });
  }
}
