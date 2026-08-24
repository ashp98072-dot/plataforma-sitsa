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
import ViajeForm from "./viaje-form";

export default async function ViajesPage() {
  const session = await getColaboradorSession();
  if (!session) {
    redirect("/portal/login");
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
    personal.tipo === "Piloto"
      ? obtenerViajeAbiertoDeEmpleado(session!.empresaId, session!.empleadoId)
      : Promise.resolve(null),
    listarAsignacionesOperativasEmpleado(session!.empresaId, session!.empleadoId),
  ]);
  const asignacionEnCurso = asignaciones.find(
    (a) => a.viajeId && a.viajeEstado === "abierto",
  ) ?? null;
  const paradas = asignacionEnCurso
    ? await listarParadasDelPlan(asignacionEnCurso.planId)
    : [];

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
              ? " Como piloto también registras salida, kilometraje y llegada."
              : " Como auxiliar puedes aportar evidencias en el mismo viaje."}
          </p>
        </header>

        <ViajeForm
          tipo={personal.tipo}
          viajeAbierto={viajeAbiertoPiloto}
          asignaciones={asignaciones}
          asignacionEnCurso={asignacionEnCurso}
          viajeEnCursoId={asignacionEnCurso?.viajeId ?? viajeAbiertoPiloto?.id ?? null}
          paradas={paradas}
        />
      </div>
    </main>
  );
}
