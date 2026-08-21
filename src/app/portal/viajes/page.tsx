import Link from "next/link";
import { redirect } from "next/navigation";
import { getColaboradorSession } from "@/lib/rrhh/colaborador-session";
import { obtenerEmpleado } from "@/lib/rrhh/empleados";
import { obtenerPilotoDeEmpleado } from "@/lib/flota/pilotos";
import { obtenerViajeAbiertoDeEmpleado } from "@/lib/flota/viajes-piloto";
import { buscarPlanesParaSalida } from "@/lib/tms/planes-salida";
import ViajeForm from "./viaje-form";

export default async function ViajesPage() {
  const session = await getColaboradorSession();
  if (!session) {
    redirect("/portal/login");
  }

  const [piloto, empleado] = await Promise.all([
    obtenerPilotoDeEmpleado(session!.empresaId, session!.empleadoId),
    obtenerEmpleado(session!.empresaId, session!.empleadoId),
  ]);

  if (!piloto || !empleado) {
    return (
      <main className="min-h-screen p-4 sm:p-8">
        <div className="mx-auto max-w-3xl">
          <Link href="/portal" className="text-sm text-[var(--muted)] hover:underline">
            ← Volver
          </Link>
          <p className="mt-8 text-sm text-[var(--muted)]">
            Esta pantalla es solo para pilotos registrados en TMS. Si crees
            que esto es un error, contacta a Operaciones.
          </p>
        </div>
      </main>
    );
  }

  const viajeAbierto = await obtenerViajeAbiertoDeEmpleado(
    session!.empresaId,
    session!.empleadoId,
  );

  // Aviso informativo: ¿Operaciones ya te asignó una ruta hoy? La vinculación
  // real (Fase 4) ocurre en el servidor al registrar la salida; esto es solo
  // para que el piloto lo vea antes de marcar.
  const planesHoy = viajeAbierto
    ? []
    : await buscarPlanesParaSalida(session!.empresaId, {
        pilotoNombre: empleado.nombre,
      });

  return (
    <main className="min-h-screen p-4 sm:p-8">
      <div className="mx-auto max-w-3xl">
        <Link href="/portal" className="text-sm text-[var(--muted)] hover:underline">
          ← Volver
        </Link>

        <header className="mt-4">
          <p className="text-sm uppercase tracking-[0.2em] text-[var(--muted)]">
            Portal del piloto
          </p>
          <h1 className="mt-1 text-2xl font-semibold">Marcar viaje</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Registra la salida y llegada de tu camión con el kilometraje. Si
            Operaciones ya te asignó una ruta hoy, se vincula automáticamente.
          </p>
        </header>

        <ViajeForm viajeAbierto={viajeAbierto} planesHoy={planesHoy} />
      </div>
    </main>
  );
}
