import { NextResponse } from "next/server";
import { z } from "zod";
import { getColaboradorSession } from "@/lib/rrhh/colaborador-session";
import {
  listarHorasExtraPorSupervisor,
  listarHorasExtraPropias,
  listarSubordinados,
  registrarHorasExtra,
} from "@/lib/rrhh/horas-extra";

/**
 * Igual que el resto del portal: empresaId/empleadoId SIEMPRE salen de la
 * sesión del colaborador, nunca de query/body — así nadie puede registrar
 * horas a nombre de otro supervisor cambiando un id.
 */
export async function GET() {
  const session = await getColaboradorSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  }

  const [subordinados, registrosEquipo, propias] = await Promise.all([
    listarSubordinados(session.empresaId, session.empleadoId),
    listarHorasExtraPorSupervisor(session.empresaId, session.empleadoId),
    listarHorasExtraPropias(session.empresaId, session.empleadoId),
  ]);

  return NextResponse.json({ subordinados, registrosEquipo, propias });
}

const schema = z.object({
  empleadoId: z.number().int().positive(),
  fecha: z.string().min(8),
  horas: z.number().positive(),
  motivo: z.string().max(500).optional(),
});

export async function POST(req: Request) {
  const session = await getColaboradorSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  }

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }
  const d = parsed.data;

  const r = await registrarHorasExtra({
    empresaId: session.empresaId,
    supervisorId: session.empleadoId,
    supervisorNombre: session.nombre || "Supervisor",
    empleadoId: d.empleadoId,
    fecha: d.fecha,
    horas: d.horas,
    motivo: d.motivo ?? null,
  });

  if (!r.ok) {
    return NextResponse.json({ error: r.mensaje }, { status: 400 });
  }
  return NextResponse.json({ ok: true, mensaje: r.mensaje, id: r.id });
}