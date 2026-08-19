import { NextResponse } from "next/server";
import { requireTenantRrhh } from "@/lib/tenant";
import { obtenerSolicitud } from "@/lib/rrhh/solicitudes-vacaciones";
import { calcularSaldoTotalDisponible } from "@/lib/rrhh/vacaciones";
import { obtenerEmpleado } from "@/lib/rrhh/empleados";
import { boletaVacacionesPdf } from "@/lib/rrhh/export-files";

type Ctx = { params: Promise<{ slug: string; id: string }> };

/**
 * GET /api/empresas/[slug]/rrhh/vacaciones/solicitudes/[id]/boleta
 * Descarga la boleta PDF de una solicitud ya resuelta (Aprobada o
 * Rechazada). No se genera para solicitudes Pendientes: todavía no hay
 * nada que respaldar con firma.
 */
export async function GET(_req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "vacaciones", "ver");
  if (guard.error) return guard.error;

  const solicitudId = Number(id);
  if (!Number.isFinite(solicitudId) || solicitudId <= 0) {
    return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  }

  const sol = await obtenerSolicitud(guard.empresa.id, solicitudId);
  if (!sol) {
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

  const empleado = await obtenerEmpleado(guard.empresa.id, sol.empleadoId);
  if (!empleado) {
    return NextResponse.json(
      { error: "El empleado de esta solicitud ya no existe." },
      { status: 404 },
    );
  }

  let saldoAntes: number | null = null;
  let saldoDespues: number | null = null;
  if (sol.estado === "Aprobada") {
    const saldoActual = await calcularSaldoTotalDisponible(
      guard.empresa.id,
      sol.empleadoId,
    );
    saldoDespues = saldoActual;
    saldoAntes = Math.round((saldoActual + sol.diasHabiles) * 100) / 100;
  }

  const buf = await boletaVacacionesPdf({
    empresaNombre: guard.empresa.nombre,
    empresaLogoUrl: guard.empresa.logoUrl,
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
      "Content-Disposition": `attachment; filename="boleta-vacaciones-${empleado.codigo || sol.empleadoId}-${sol.fechaInicio}.pdf"`,
    },
  });
}