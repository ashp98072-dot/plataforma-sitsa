import { NextResponse } from "next/server";
import { getColaboradorSession } from "@/lib/rrhh/colaborador-session";
import { listarPeriodos, listarLineas } from "@/lib/rrhh/planillas";

// Solo periodos ya finalizados: mientras un periodo está en "Generada",
// RRHH todavía puede editar montos (ISR, forma de pago, etc.) desde su
// panel — el colaborador nunca debe ver una cifra que aún podría cambiar.
const ESTADOS_VISIBLES_COLABORADOR = ["Cerrada", "Pagada"];

export async function GET() {
  const session = await getColaboradorSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  }

  const periodos = await listarPeriodos(session.empresaId);
  const finalizados = periodos.filter((p) =>
    ESTADOS_VISIBLES_COLABORADOR.includes(p.estado),
  );

  const boletas = [];
  for (const periodo of finalizados) {
    const lineas = await listarLineas(session.empresaId, periodo.id);
    const propia = lineas.find((l) => l.empleadoId === session.empleadoId);
    if (!propia) continue; // no trabajaba, o no tenía línea en ese periodo
    boletas.push({
      periodoId: periodo.id,
      codigo: periodo.codigo,
      fechaInicio: periodo.fechaInicio,
      fechaFin: periodo.fechaFin,
      estado: periodo.estado,
      estadoPago: propia.estadoPago,
      neto: propia.neto,
    });
  }

  boletas.sort((a, b) => (a.fechaInicio < b.fechaInicio ? 1 : -1));

  return NextResponse.json({ boletas });
}
