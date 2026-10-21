import { NextResponse } from "next/server";
import { getColaboradorSession } from "@/lib/rrhh/colaborador-session";
import { listarPeriodos, listarLineasEmpleadoPorPeriodos } from "@/lib/rrhh/planillas";

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

  const lineas = await listarLineasEmpleadoPorPeriodos(
    session.empresaId, session.empleadoId, finalizados.map((p) => p.id),
  );
  const porPeriodo = new Map<number, (typeof lineas)[number]>();
  for (const linea of lineas) {
    if (!porPeriodo.has(linea.periodoId)) porPeriodo.set(linea.periodoId, linea);
  }
  const boletas = [];
  for (const periodo of finalizados) {
    const propia = porPeriodo.get(periodo.id);
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
