import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getColaboradorSession } from "@/lib/rrhh/colaborador-session";
import { listarEquipoVacaciones } from "@/lib/rrhh/vacaciones-equipo";
import { calcularSaldoTotalDisponible } from "@/lib/rrhh/vacaciones";
import { listarSolicitudesPorEmpleado } from "@/lib/rrhh/solicitudes-vacaciones";
import SolicitarVacacionesForm from "../solicitar-form";

export default async function VacacionesEquipoPage({ searchParams }: {
  searchParams: Promise<{ empleadoId?: string }>;
}) {
  const session = await getColaboradorSession();
  if (!session) redirect("/portal/login");
  const equipo = await listarEquipoVacaciones(session.empresaId, session.empleadoId);
  const { empleadoId } = await searchParams;
  const elegido = empleadoId ? equipo.find((e) => e.id === Number(empleadoId)) : undefined;
  // Antes de cualquier consulta de saldo o historial: no revelar otros empleados.
  if (empleadoId && !elegido) notFound();
  const [saldo, solicitudes] = elegido ? await Promise.all([
    calcularSaldoTotalDisponible(session.empresaId, elegido.id),
    listarSolicitudesPorEmpleado(session.empresaId, elegido.id),
  ]) : [0, []];
  return (
    <main className="min-h-screen p-4 sm:p-8">
      <div className="mx-auto max-w-3xl space-y-5">
        <Link href="/portal/vacaciones" className="text-sm underline">← Mis vacaciones</Link>
        <h1 className="text-2xl font-semibold">Vacaciones de mi equipo</h1>
        <p className="text-sm text-[var(--muted)]">Puedes solicitar para colaboradores activos que RRHH te haya asignado. La aprobación sigue a cargo de RRHH; solicitar no descuenta días.</p>
        {equipo.length === 0 ? <p>No tienes colaboradores asignados actualmente.</p> : (
          <form action="/portal/vacaciones/equipo" method="get" className="flex flex-wrap items-end gap-3">
            <label className="block text-sm">Colaborador
              <select key={empleadoId ?? "sin-seleccion"} name="empleadoId" required defaultValue={elegido?.id ?? ""} className="mt-1 block rounded-lg border border-[var(--border)] bg-[var(--input)] p-2">
                <option value="" disabled>Seleccionar…</option>
                {equipo.map((e) => <option key={e.id} value={e.id}>{e.codigo} · {e.nombre}</option>)}
              </select>
            </label>
            <button className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm text-white">Consultar</button>
          </form>
        )}
        {elegido ? <>
          <h2 className="text-lg font-semibold">{elegido.nombre}</h2>
          <SolicitarVacacionesForm key={elegido.id} saldoDisponible={saldo} empleadoId={elegido.id} />
          <section className="space-y-3">
            <h2 className="font-semibold">Solicitudes del colaborador</h2>
            {solicitudes.map((s) => <article key={s.id} className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 text-sm">
              <p>{s.fechaInicio} → {s.fechaFin} · {s.diasHabiles} día(s) · {s.estado}</p>
              {s.comentarioColaborador ? <p className="mt-2 whitespace-pre-wrap">{s.comentarioColaborador}</p> : null}
              {s.comentarioRrhh ? <p className="mt-2">RRHH: {s.comentarioRrhh}</p> : null}
            </article>)}
            {!solicitudes.length ? <p className="text-sm">Sin solicitudes registradas.</p> : null}
          </section>
        </> : null}
      </div>
    </main>
  );
}
