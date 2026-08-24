import Link from "next/link";
import { redirect } from "next/navigation";
import { getColaboradorSession } from "@/lib/rrhh/colaborador-session";
import { obtenerEmpleado } from "@/lib/rrhh/empleados";
import {
  listarHorasExtraPorSupervisor,
  listarHorasExtraPropias,
  listarSubordinados,
} from "@/lib/rrhh/horas-extra";
import RegistrarHorasExtraForm from "./registrar-form";
import EquipoRegistros from "./equipo-registros";
import EstadoBadge from "./estado-badge";

function formatQ(valor: number): string {
  return `Q${valor.toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default async function HorasExtraPage() {
  const session = await getColaboradorSession();
  if (!session) {
    redirect("/portal/login");
  }

  const [empleado, subordinados, registrosEquipo, propias] = await Promise.all([
    obtenerEmpleado(session!.empresaId, session!.empleadoId),
    listarSubordinados(session!.empresaId, session!.empleadoId),
    listarHorasExtraPorSupervisor(session!.empresaId, session!.empleadoId),
    listarHorasExtraPropias(session!.empresaId, session!.empleadoId),
  ]);

  const esSupervisor = subordinados.length > 0;
  if (!empleado?.horasExtraHabilitado && !esSupervisor) {
    return (
      <main className="min-h-screen p-4 sm:p-8">
        <div className="mx-auto max-w-3xl">
          <Link href="/portal" className="text-sm text-[var(--muted)] hover:underline">← Volver</Link>
          <div className="mt-6 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6">
            <h1 className="text-xl font-semibold">Horas extra no habilitadas</h1>
            <p className="mt-2 text-sm text-[var(--muted)]">
              RRHH debe habilitar las horas extra en tu ficha antes de que puedas acceder a esta sección.
            </p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen p-4 sm:p-8">
      <div className="mx-auto max-w-3xl">
        <Link href="/portal" className="text-sm text-[var(--muted)] hover:underline">
          ← Volver
        </Link>

        <header className="mt-4">
          <p className="text-sm uppercase tracking-[0.2em] text-[var(--muted)]">
            Horas extra
          </p>
          <h1 className="mt-1 text-2xl font-semibold">
            {esSupervisor ? "Mi equipo" : "Mis horas extra"}
          </h1>
        </header>

        {esSupervisor ? (
          <>
            <div className="mt-6">
              <RegistrarHorasExtraForm subordinados={subordinados} />
            </div>

            <section className="mt-6">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
                Registros de mi equipo
              </h2>
              {registrosEquipo.length === 0 ? (
                <p className="mt-3 text-sm text-[var(--muted)]">
                  Todavía no has registrado horas extra para tu equipo.
                </p>
              ) : (
                <EquipoRegistros registros={registrosEquipo} />
              )}
            </section>
          </>
        ) : null}

        <section className={esSupervisor ? "mt-8" : "mt-6"}>
          {esSupervisor ? (
            <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
              Mis propias horas extra
            </h2>
          ) : null}
          {propias.length === 0 ? (
            <p className="mt-3 text-sm text-[var(--muted)]">
              No tienes horas extra registradas todavía.
            </p>
          ) : (
            <div className="mt-3 space-y-2">
              {propias.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4"
                >
                  <div>
                    <p className="font-medium">{r.fecha}</p>
                    <p className="mt-0.5 text-sm text-[var(--muted)]">
                      {r.horas} hora(s) · registrado por {r.registradoPorNombre}
                    </p>
                    {r.estado === "RECHAZADA" && r.motivoRechazo ? (
                      <p className="mt-0.5 text-xs text-red-300">
                        Motivo: {r.motivoRechazo}
                      </p>
                    ) : null}
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold">{formatQ(r.monto)}</p>
                    <div className="mt-1">
                      <EstadoBadge estado={r.estado} pagada={r.pagada} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
