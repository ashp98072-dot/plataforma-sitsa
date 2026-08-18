import Link from "next/link";
import { redirect } from "next/navigation";
import { getColaboradorSession } from "@/lib/rrhh/colaborador-session";
import { listarEntrevistasPorEntrevistador } from "@/lib/rrhh/entrevistas";
import EntrevistaCard from "./entrevista-card";

export default async function EntrevistasPortalPage() {
  const session = await getColaboradorSession();
  if (!session) {
    redirect("/portal/login");
  }

  const todas = await listarEntrevistasPorEntrevistador(
    session!.empresaId,
    session!.empleadoId,
  );
  const proximas = todas.filter((e) => e.estado === "Programada");
  const pasadas = todas.filter((e) => e.estado !== "Programada");

  return (
    <main className="min-h-screen p-4 sm:p-8">
      <div className="mx-auto max-w-3xl">
        <Link href="/portal" className="text-sm text-[var(--muted)] hover:underline">
          ← Volver
        </Link>

        <header className="mt-4">
          <p className="text-sm uppercase tracking-[0.2em] text-[var(--muted)]">
            Entrevistas
          </p>
          <h1 className="mt-1 text-2xl font-semibold">Mis entrevistas asignadas</h1>
        </header>

        <section className="mt-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
            Próximas
          </h2>
          {proximas.length === 0 ? (
            <p className="mt-3 text-sm text-[var(--muted)]">
              No tienes entrevistas programadas.
            </p>
          ) : (
            <div className="mt-3 space-y-3">
              {proximas.map((e) => (
                <EntrevistaCard key={e.id} entrevista={e} />
              ))}
            </div>
          )}
        </section>

        <section className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
            Historial
          </h2>
          {pasadas.length === 0 ? (
            <p className="mt-3 text-sm text-[var(--muted)]">
              Todavía no tienes entrevistas realizadas.
            </p>
          ) : (
            <div className="mt-3 space-y-3">
              {pasadas.map((e) => (
                <EntrevistaCard key={e.id} entrevista={e} />
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}