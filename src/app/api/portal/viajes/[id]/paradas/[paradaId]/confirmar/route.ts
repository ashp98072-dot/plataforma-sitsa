import { NextResponse } from "next/server";
import { getColaboradorSession } from "@/lib/rrhh/colaborador-session";
import { obtenerEmpleado } from "@/lib/rrhh/empleados";
import { colaboradorParticipaEnViaje } from "@/lib/flota/viajes-piloto";
import { confirmarParadaPorPiloto, confirmarParadaSchema, listarConfirmacionesPlan } from "@/lib/tms/parada-confirmacion";

type Ctx = { params: Promise<{ id: string; paradaId: string }> };

/**
 * TMS-ENTREGA-PILOTO-1 — confirmación de entrega por parada, hecha por el piloto desde el Portal. La empresa y la identidad salen de la sesión del colaborador
 * (nunca del cuerpo); el viaje debe ser uno en el que el colaborador participa. Solo el piloto principal o extra confirma (lo valida el dominio); no hay aprobación previa
 * de personal. NO publica ningún estado externo ni equivale a una recepción aceptada por PriceSmart.
 */
async function contexto(ctx: Ctx) {
  const session = await getColaboradorSession();
  const { id, paradaId } = await ctx.params;
  const viajeId = Number(id); const parada = Number(paradaId);
  if (!session) return { ok: false, error: NextResponse.json({ error: "No autenticado." }, { status: 401 }) } as const;
  if (!Number.isSafeInteger(viajeId) || viajeId <= 0 || !Number.isSafeInteger(parada) || parada <= 0) return { ok: false, error: NextResponse.json({ error: "Parada no encontrada." }, { status: 404 }) } as const;
  const participacion = await colaboradorParticipaEnViaje(session.empresaId, session.empleadoId, viajeId);
  if (!participacion) return { ok: false, error: NextResponse.json({ error: "No estás asignado a este viaje." }, { status: 403 }) } as const;
  if (!participacion.planId) return { ok: false, error: NextResponse.json({ error: "El viaje aún no está vinculado a su programación." }, { status: 409 }) } as const;
  return { ok: true, session, viajeId, parada, planId: participacion.planId } as const;
}

export async function GET(_req: Request, ctx: Ctx): Promise<Response> {
  const c = await contexto(ctx);
  if (!c.ok) return c.error;
  const todas = await listarConfirmacionesPlan(c.session.empresaId, c.planId);
  return NextResponse.json({ confirmaciones: todas.filter((x) => x.paradaId === c.parada) });
}

export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  const c = await contexto(ctx);
  if (!c.ok) return c.error;
  let raw: unknown;
  try { raw = await req.json(); } catch { return NextResponse.json({ error: "Datos inválidos." }, { status: 400 }); }
  const parsed = confirmarParadaSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  const empleado = await obtenerEmpleado(c.session.empresaId, c.session.empleadoId);
  if (!empleado) return NextResponse.json({ error: "Colaborador no encontrado." }, { status: 404 });
  const r = await confirmarParadaPorPiloto({
    empresaId: c.session.empresaId, empleadoId: c.session.empleadoId, usuario: `portal:${empleado.codigo}`,
    viajeId: c.viajeId, planId: c.planId, paradaId: c.parada, body: parsed.data,
  });
  if (!r.ok) return NextResponse.json({ error: r.mensaje, codigo: r.codigo }, { status: r.status });
  return NextResponse.json({ confirmacion: r.confirmacion, replayed: r.replayed }, { status: r.replayed ? 200 : 201 });
}
