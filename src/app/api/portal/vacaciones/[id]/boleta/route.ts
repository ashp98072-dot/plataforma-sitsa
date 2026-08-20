import { NextResponse } from "next/server";
import { getColaboradorSession } from "@/lib/rrhh/colaborador-session";
import { obtenerSolicitud } from "@/lib/rrhh/solicitudes-vacaciones";
import { calcularSaldoTotalDisponible } from "@/lib/rrhh/vacaciones";
import { obtenerEmpleado } from "@/lib/rrhh/empleados";
import { obtenerEmpresaPorId } from "@/lib/empresas";
import { boletaVacacionesPdf } from "@/lib/rrhh/export-files";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const session = await getColaboradorSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  }

  const solicitudId = Number((await ctx.params).id);
  if (!Number.isFinite(solicitudId) || solicitudId <= 0) {
    return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  }

  const sol = await obtenerSolicitud(session.empresaId, solicitudId);
  if (!sol || sol.empleadoId !== session.empleadoId) {
    return NextResponse.json(
      { error: "Solicitud no encontrada." },
      { status: 404 },
    );
  }
  if (sol.estado === "Pendiente") {
    return NextResponse.json(
      {
        error:
          "La solicitud todavía está pendiente; la boleta solo se genera una vez aprobada o rechazada.",
      },
      { status: 400 },
    );
  }

  const [empleado, empresa] = await Promise.all([
    obtenerEmpleado(session.empresaId, sol.empleadoId),
    obtenerEmpresaPorId(session.empresaId),
  ]);
  if (!empleado || !empresa) {
    return NextResponse.json(
      { error: "No se pudo generar la boleta." },
      { status: 404 },
    );
  }

  let saldoAntes: number | null = null;
  let saldoDespues: number | null = null;
  if (sol.estado === "Aprobada") {
    const saldoActual = await calcularSaldoTotalDisponible(
      session.empresaId,
      sol.empleadoId,
    );
    saldoDespues = saldoActual;
    saldoAntes = Math.round((saldoActual + sol.diasHabiles) * 100) / 100;
  }

  const buf = await boletaVacacionesPdf({
    empresaNombre: empresa.nombre,
    empresaLogoUrl: empresa.logoUrl,
    empleadoNombre: empleado.nombre,
    empleadoCodigo: empleado.codigo,
    empleadoPuesto: empleado.puesto,
    empleadoDpi: empleado.dpi,
    jefeNombre: empleado.supervisorNombre,
    solicitud: {
      tipo: sol.tipo,
      fechaInicio: sol.fechaInicio,
      fechaFin: sol.fechaFin,
      diasHabiles: sol.diasHabiles,
      estado: sol.estado,
      comentarioColaborador: sol.comentarioColaborador,
      comentarioRrhh: sol.comentarioRrhh,
      resueltoEn: sol.resueltoEn,
      resueltoPor: sol.resueltoPor,
    },
    saldoAntes,
    saldoDespues,
  });

  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="boleta-vacaciones-${sol.fechaInicio}.pdf"`,
    },
  });
}