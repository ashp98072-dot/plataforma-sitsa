import Link from "next/link";
import { redirect } from "next/navigation";
import { getColaboradorSession } from "@/lib/rrhh/colaborador-session";
import {
  calcularSaldoTotalDisponible,
  obtenerPeriodosDisponibles,
} from "@/lib/rrhh/vacaciones";
import { listarSolicitudesPorEmpleado } from "@/lib/rrhh/solicitudes-vacaciones";
import SolicitarVacacionesForm from "./solicitar-form";

const ESTADO_COLOR: Record<string, string> = {
  Pendiente: "text-[#e8c468]",
  Aprobada: "text-[#8fd4a0]",
  Rechazada: "text-[#e08a8a]",
};

export default async function VacacionesPage() {
  const session = await getColaboradorSession();
  if (!session) {
    redirect("/portal/login");
  }

  const [saldo, periodos, solicitudes] = await Promise.all([
    calcularSaldoTotalDisponible(session!.empresaId, session!.empleadoId),
    obtenerPeriodosDisponibles(session!.empresaId, session!.empleadoId),
    listarSolicitudesPorEmpleado(session!.empresaId, session!.empleadoId),
  ]);

  return (
    <main className="min-h-screen p-4 sm:p-8">
      <div className="mx-auto max-w-3xl">
        <Link href="/portal" className="text-sm text-[var(--muted)] hover:underline">
          ← Volver
        </Link>

        <header className="mt-4">
          <p className="text-sm uppercase tracking-[0.2em] text-[var(--muted)]">
            Vacaciones
          </p>
          <h1 className="mt-1 text-2xl font-semibold">
            {saldo.toFixed(2)} día(s) disponibles
          </h1>
        </header>

        {periodos.length > 0 ? (
          <section className="mt-6 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
              Desglose por periodo
            </h2>
            <div className="mt-3 space-y-2">
              {periodos.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between text-sm"
                >
                  <span className="text-[var(--muted)]">
                    {p.periodoInicio} → {p.periodoFin}
                  </span>
                  <span>
                    {p.diasDisponibles.toFixed(2)} / {p.diasOtorgados.toFixed(2)} días
                  </span>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <div className="mt-6">
          <SolicitarVacacionesForm saldoDisponible={saldo} />
        </div>

        <section className="mt-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
            Mis solicitudes
          </h2>
          {solicitudes.length === 0 ? (
            <p className="mt-3 text-sm text-[var(--muted)]">
              Todavía no has hecho ninguna solicitud.
            </p>
          ) : (
            <div className="mt-3 space-y-3">
              {solicitudes.map((s) => (
                <div
                  key={s.id}
                  className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5"
                >
                  <div className="flex items-center justify-between">
                    <p className="font-medium">
                      {s.fechaInicio} → {s.fechaFin}
                    </p>
                    <p
                      className={`text-xs font-semibold uppercase ${ESTADO_COLOR[s.estado] ?? "text-[var(--muted)]"}`}
                    >
                      {s.estado}
                    </p>
                  </div>
                  <p className="mt-1 text-sm text-[var(--muted)]">
                    {s.tipo} · {s.diasHabiles} día(s)
                  </p>
                  {s.comentarioColaborador ? (
                    <p className="mt-2 text-sm">“{s.comentarioColaborador}”</p>
                  ) : null}
                  {s.comentarioRrhh ? (
                    <p className="mt-2 text-sm text-[var(--muted)]">
                      RRHH: {s.comentarioRrhh}
                    </p>
                  ) : null}
                  {s.estado !== "Pendiente" ? (
                    <a
                      href={`/api/portal/vacaciones/${s.id}/boleta`}
                      className="mt-3 inline-block text-sm text-[var(--accent)] underline"
                    >
                      Descargar boleta (PDF)
                    </a>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
