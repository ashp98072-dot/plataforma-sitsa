import { NextResponse } from "next/server";
import { getColaboradorSession } from "@/lib/rrhh/colaborador-session";
import { obtenerPeriodo, listarLineas } from "@/lib/rrhh/planillas";

const ESTADOS_VISIBLES_COLABORADOR = ["Cerrada", "Pagada"];

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getColaboradorSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  }

  const periodoId = Number((await params).id);
  if (!Number.isFinite(periodoId)) {
    return NextResponse.json({ error: "Periodo inválido." }, { status: 400 });
  }

  // obtenerPeriodo ya filtra por empresaId de la sesión (no del parámetro),
  // así que un colaborador no puede ver el periodo de otra empresa aunque
  // adivine un id válido.
  const periodo = await obtenerPeriodo(session.empresaId, periodoId);
  if (!periodo || !ESTADOS_VISIBLES_COLABORADOR.includes(periodo.estado)) {
    return NextResponse.json({ error: "Boleta no encontrada." }, { status: 404 });
  }

  const lineas = await listarLineas(session.empresaId, periodoId);
  const propia = lineas.find((l) => l.empleadoId === session.empleadoId);
  if (!propia) {
    return NextResponse.json({ error: "Boleta no encontrada." }, { status: 404 });
  }

  return NextResponse.json({
    periodo: {
      codigo: periodo.codigo,
      fechaInicio: periodo.fechaInicio,
      fechaFin: periodo.fechaFin,
      estado: periodo.estado,
    },
    linea: propia,
  });
}
