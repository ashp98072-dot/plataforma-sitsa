import Link from "next/link";
import { redirect } from "next/navigation";
import { getColaboradorSession } from "@/lib/rrhh/colaborador-session";
import { hoyLocal } from "@/lib/rrhh/dates";
import { listarMarcajesEmpleadoRango } from "@/lib/rrhh/marcajes";

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

function hace14Dias(hoyIso: string): string {
  const [y, m, d] = hoyIso.split("-").map(Number);
  const fecha = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  fecha.setUTCDate(fecha.getUTCDate() - 14);
  return `${fecha.getUTCFullYear()}-${String(fecha.getUTCMonth() + 1).padStart(2, "0")}-${String(
    fecha.getUTCDate(),
  ).padStart(2, "0")}`;
}

function colorIncidencia(incidencia: string): string {
  if (incidencia === "Retraso") return "text-[#e0a458]";
  if (incidencia === "A tiempo" || incidencia === "Presente")
    return "text-[#8fd4a0]";
  return "text-[var(--muted)]";
}

export default async function MarcajesPage({
  searchParams,
}: {
  searchParams: Promise<{ desde?: string; hasta?: string }>;
}) {
  const session = await getColaboradorSession();
  if (!session) {
    redirect("/portal/login");
  }

  const sp = await searchParams;
  const hoy = hoyLocal();
  const desde = sp.desde && FECHA_RE.test(sp.desde) ? sp.desde : hace14Dias(hoy);
  const hasta = sp.hasta && FECHA_RE.test(sp.hasta) ? sp.hasta : hoy;

  const marcajes =
    desde <= hasta
      ? await listarMarcajesEmpleadoRango(
          session!.empresaId,
          session!.empleadoId,
          desde,
          hasta,
        )
      : [];

  return (
    <main className="min-h-screen p-4 sm:p-8">
      <div className="mx-auto max-w-3xl">
        <Link href="/portal" className="text-sm text-[var(--muted)] hover:underline">
          ← Volver
        </Link>

        <header className="mt-4">
          <p className="text-sm uppercase tracking-[0.2em] text-[var(--muted)]">
            Reporte de marcajes
          </p>
          <h1 className="mt-1 text-2xl font-semibold">Mis marcajes</h1>
        </header>

        {/* Filtro por GET: no requiere JavaScript, funciona igual con y sin cliente */}
        <form
          method="get"
          className="mt-6 flex flex-wrap items-end gap-3 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4"
        >
          <label className="flex flex-col text-sm">
            <span className="mb-1 text-[var(--muted)]">Desde</span>
            <input
              type="date"
              name="desde"
              defaultValue={desde}
              className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2"
            />
          </label>
          <label className="flex flex-col text-sm">
            <span className="mb-1 text-[var(--muted)]">Hasta</span>
            <input
              type="date"
              name="hasta"
              defaultValue={hasta}
              className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2"
            />
          </label>
          <button
            type="submit"
            className="rounded-lg border border-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent)] transition hover:bg-[var(--accent)] hover:text-[var(--background)]"
          >
            Filtrar
          </button>
        </form>

        {desde > hasta ? (
          <p className="mt-8 text-sm text-[#e0a458]">
            La fecha &quot;Desde&quot; no puede ser posterior a &quot;Hasta&quot;.
          </p>
        ) : marcajes.length === 0 ? (
          <p className="mt-8 text-sm text-[var(--muted)]">
            No hay marcajes registrados en este rango de fechas.
          </p>
        ) : (
          <div className="mt-6 space-y-2">
            {marcajes.map((m) => (
              <div
                key={m.fecha}
                className="flex items-center justify-between rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4"
              >
                <div>
                  <p className="font-medium">{m.fecha}</p>
                  <p className="mt-0.5 text-sm text-[var(--muted)]">
                    {m.entrada || "—"} → {m.salida || "—"}
                    {m.viajeLargo ? " · Viaje largo" : ""}
                  </p>
                </div>
                <p className={`text-sm font-medium ${colorIncidencia(m.incidencia)}`}>
                  {m.incidencia}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
