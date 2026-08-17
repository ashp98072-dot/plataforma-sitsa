import { NextResponse } from "next/server";
import { z } from "zod";
import { getColaboradorSession } from "@/lib/rrhh/colaborador-session";
import {
  calcularSaldoTotalDisponible,
  obtenerPeriodosDisponibles,
} from "@/lib/rrhh/vacaciones";
import {
  crearSolicitudVacaciones,
  listarSolicitudesPorEmpleado,
} from "@/lib/rrhh/solicitudes-vacaciones";

/**
 * Igual que /api/portal/ficha: el empleadoId SIEMPRE sale de la sesión del
 * colaborador, nunca de query/body, para que no pueda ver ni solicitar a
 * nombre de otro empleado cambiando un id.
 */
export async function GET() {
  const session = await getColaboradorSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  }

  const [saldo, periodos, solicitudes] = await Promise.all([
    calcularSaldoTotalDisponible(session.empresaId, session.empleadoId),
    obtenerPeriodosDisponibles(session.empresaId, session.empleadoId),
    listarSolicitudesPorEmpleado(session.empresaId, session.empleadoId),
  ]);

  return NextResponse.json({ saldo, periodos, solicitudes });
}

const schema = z.object({
  fechaInicio: z.string().min(8),
  fechaFin: z.string().min(8),
  tipo: z.enum(["Vacaciones", "A cuenta de Vacaciones"]).default("Vacaciones"),
  comentario: z.string().max(500).optional(),
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

  const r = await crearSolicitudVacaciones({
    empresaId: session.empresaId,
    empleadoId: session.empleadoId,
    fechaInicio: d.fechaInicio,
    fechaFin: d.fechaFin,
    tipo: d.tipo,
    comentario: d.comentario ?? null,
  });
  if (!r.ok) {
    return NextResponse.json({ error: r.mensaje }, { status: 400 });
  }
  return NextResponse.json({ ok: true, mensaje: r.mensaje, id: r.id });
}