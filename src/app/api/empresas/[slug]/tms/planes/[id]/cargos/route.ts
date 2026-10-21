import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantProgramacionOTms, requireTenantViajesCargosAdicionales } from "@/lib/tenant";
import { crearCargoAdicional, obtenerVistaCargosPlan } from "@/lib/tms/cargos-adicionales";
import { respuestaDeExcepcion } from "@/lib/validacion-formulario";

type Ctx = { params: Promise<{ slug: string; id: string }> };

/**
 * LIQUIDACIÓN DE VIAJES, FASE 4 — cargos adicionales FACTURABLES de un viaje. Lectura: misma visibilidad que el listado de
 * viajes (programacion:ver o tms:ver). La empresa sale de la sesión; un viaje de otra empresa es 404.
 */
export async function GET(_req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireTenantProgramacionOTms(slug, "ver");
  if (guard.error) return guard.error;
  const planId = Number(id);
  if (!Number.isInteger(planId) || planId <= 0) return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  try {
    const vista = await obtenerVistaCargosPlan(guard.empresa.id, planId);
    if (!vista) return NextResponse.json({ error: "Viaje no encontrado." }, { status: 404 });
    return NextResponse.json(vista);
  } catch (e) {
    const f = respuestaDeExcepcion(e);
    return NextResponse.json(f.cuerpo, { status: f.status });
  }
}

/** Esquema ESTRICTO: empresa, usuario y plan salen de la sesión/URL, nunca del cuerpo. */
const crearSchema = z
  .object({
    concepto: z.string().max(200),
    monto: z.union([z.number(), z.string().max(30)]),
    observacion: z.string().max(1000).nullish(),
    claveEnvio: z.string().min(16).max(64),
  })
  .strict();

/**
 * Crea un cargo. Permiso EXPLÍCITO `viajes_cargos_adicionales:editar`. No define IVA, no crea líneas de factura/FEL y no toca el
 * cierre. Idempotente por `claveEnvio`. 409 si el viaje está liquidado (reabrir la liquidación primero) o cancelado.
 */
export async function POST(req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireTenantViajesCargosAdicionales(slug, "editar");
  if (guard.error) return guard.error;
  const planId = Number(id);
  if (!Number.isInteger(planId) || planId <= 0) return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  const parsed = crearSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Solicitud inválida: se requieren concepto, monto y claveEnvio." }, { status: 400 });
  }
  try {
    const r = await crearCargoAdicional(
      { empresaId: guard.empresa.id, usuarioId: guard.session.id, usuario: guard.session.username },
      { planId, ...parsed.data },
    );
    return NextResponse.json(
      { mensaje: r.idempotente ? "El cargo ya estaba registrado." : "Cargo registrado.", idempotente: r.idempotente, evento: r.evento, cargo: r.cargo },
      { status: r.idempotente ? 200 : 201 },
    );
  } catch (e) {
    const f = respuestaDeExcepcion(e);
    return NextResponse.json(f.cuerpo, { status: f.status });
  }
}
