import Link from "next/link";
import { redirect } from "next/navigation";
import { getColaboradorSession } from "@/lib/rrhh/colaborador-session";
import { obtenerEmpleado } from "@/lib/rrhh/empleados";
import { obtenerPersonalOperativoDeEmpleado } from "@/lib/flota/pilotos";
import {
  listarAsignacionesOperativasEmpleado,
  obtenerViajeAbiertoDeEmpleado,
} from "@/lib/flota/viajes-piloto";
import { listarParadasDelPlan } from "@/lib/tms/paradas";
import { listarViaticosPropiosPorPlanes } from "@/lib/tms/viaticos";
import ViajeForm from "./viaje-form";

export default async function ViajesPage({
  searchParams,
}: {
  searchParams: Promise<{ viaje?: string }>;
}) {
  const { viaje } = await searchParams;
  const viajeDestacadoId = viaje && Number.isInteger(Number(viaje)) && Number(viaje) > 0
    ? Number(viaje)
    : null;
  const session = await getColaboradorSession();
  if (!session) {
    const retorno = viajeDestacadoId ? `/portal/viajes?viaje=${viajeDestacadoId}` : "/portal/viajes";
    redirect(`/portal/login?next=${encodeURIComponent(retorno)}`);
  }

  const [personal, empleado] = await Promise.all([
    obtenerPersonalOperativoDeEmpleado(session!.empresaId, session!.empleadoId),
    obtenerEmpleado(session!.empresaId, session!.empleadoId),
  ]);

  if (!personal || !empleado) {
    return (
      <main className="min-h-screen p-4 sm:p-8">
        <div className="mx-auto max-w-3xl">
          <Link href="/portal" className="text-sm text-[var(--muted)] hover:underline">
            ← Volver
          </Link>
          <p className="mt-8 text-sm text-[var(--muted)]">
            Esta pantalla es para pilotos y auxiliares registrados en TMS. Si crees
            que esto es un error, contacta a Operaciones.
          </p>
        </div>
      </main>
    );
  }

  const [viajeAbiertoPiloto, asignaciones] = await Promise.all([
    obtenerViajeAbiertoDeEmpleado(session!.empresaId, session!.empleadoId),
    listarAsignacionesOperativasEmpleado(session!.empresaId, session!.empleadoId),
  ]);
  const asignacionEnCurso = asignaciones.find(
    (a) => a.viajeId && a.viajeEstado === "abierto",
  ) ?? null;
  const paradas = asignacionEnCurso
    ? await listarParadasDelPlan(asignacionEnCurso.planId)
    : [];

  // VIAT-1 — enriquecer con el viático propio de cada viaje (monto + estado,
  // sin datos administrativos). Consulta independiente del JOIN de arriba,
  // ver comentario en listarViaticosPropiosPorPlanes (src/lib/tms/viaticos.ts).
  const viaticosPropios = await listarViaticosPropiosPorPlanes(
    session!.empresaId,
    session!.empleadoId,
    asignaciones.map((a) => a.planId),
  );
  const asignacionesConViatico = asignaciones.map((a) => {
    const v = viaticosPropios.get(a.planId);
    return v
      ? { ...a, viaticoAsignado: v.montoAsignado, viaticoEstado: v.estado }
      : a;
  });

  return (
    <main className="min-h-screen p-4 sm:p-8">
      <div className="mx-auto max-w-3xl">
        <Link href="/portal" className="text-sm text-[var(--muted)] hover:underline">
          ← Volver
        </Link>

        <header className="mt-4">
          <p className="text-sm uppercase tracking-[0.2em] text-[var(--muted)]">
            Portal operativo · {personal.tipo}
          </p>
          <h1 className="mt-1 text-2xl font-semibold">Mis viajes</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Consulta lo que te asignó Operaciones y adjunta evidencias del viaje.
            {personal.tipo === "Piloto"
              ? " Puedes iniciar, registrar el avance y cerrar la llegada."
              : " Como auxiliar puedes registrar carga y aportar evidencias en el mismo viaje cuando el piloto lo haya iniciado."}
          </p>
        </header>

        <ViajeForm
          tipo={personal.tipo}
          viajeAbierto={viajeAbiertoPiloto}
          asignaciones={asignacionesConViatico}
          asignacionEnCurso={asignacionEnCurso}
          viajeEnCursoId={asignacionEnCurso?.viajeId ?? viajeAbiertoPiloto?.id ?? null}
          paradas={paradas}
          viajeDestacadoId={viajeDestacadoId}
        />
      </div>
    </main>
  );
}
