import Link from "next/link";
import { redirect } from "next/navigation";
import { getColaboradorSession } from "@/lib/rrhh/colaborador-session";
import {
  listarHorasExtraPorSupervisor,
  listarHorasExtraPropias,
  listarSubordinados,
} from "@/lib/rrhh/horas-extra";
import RegistrarHorasExtraForm from "./registrar-form";

function formatQ(valor: number): string {
  return `Q${valor.toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Fase H1: badge de estado — null = registro histórico (previo a H1, ya
 * procesado, no se reinterpreta).
 *
 * Fase H3: `pagada` es puramente informativo, derivado en el servidor (ver
 * marcarPagadas() en horas-extra.ts) cruzando contra
 * rrhh_planilla_lineas.estado_pago — NO es un estado guardado en
 * horas_extra_registros. Cuando una hora extra APLICADA_EN_PLANILLA ya fue
 * realmente pagada, se muestra "Pagada" en vez de "Aplicada a planilla".
 */
function EstadoBadge({ estado, pagada }: { estado: string | null; pagada?: boolean }) {
  const map: Record<string, { label: string; className: string }> = {
    PENDIENTE: { label: "Pendiente", className: "bg-amber-500/20 text-amber-300" },
    APROBADA: { label: "Aprobada", className: "bg-emerald-500/20 text-emerald-300" },
    RECHAZADA: { label: "Rechazada", className: "bg-red-500/20 text-red-300" },
    APLICADA_EN_PLANILLA: {
      label: "Aplicada a planilla",
      className: "bg-sky-500/20 text-sky-300",
    },
    PAGADA: { label: "Pagada", className: "bg-green-500/20 text-green-300" },
  };
  const clave = estado === "APLICADA_EN_PLANILLA" && pagada ? "PAGADA" : estado;
  const info = clave != null ? map[clave] : null;
  const { label, className } = info ?? {
    label: "Histórico",
    className: "bg-white/10 text-[var(--muted)]",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${className}`}>
      {label}
    </span>
  );
}

export default async function HorasExtraPage() {
  const session = await getColaboradorSession();
  if (!session) {
    redirect("/portal/login");
  }

  const [subordinados, registrosEquipo, propias] = await Promise.all([
    listarSubordinados(session!.empresaId, session!.empleadoId),
    listarHorasExtraPorSupervisor(session!.empresaId, session!.empleadoId),
    listarHorasExtraPropias(session!.empresaId, session!.empleadoId),
  ]);

  const esSupervisor = subordinados.length > 0;

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
                <div className="mt-3 space-y-2">
                  {registrosEquipo.map((r) => (
                    <div
                      key={r.id}
                      className="flex items-center justify-between rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4"
                    >
                      <div>
                        <p className="font-medium">{r.empleadoNombre}</p>
                        <p className="mt-0.5 text-sm text-[var(--muted)]">
                          {r.fecha} · {r.horas} hora(s)
                        </p>
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
