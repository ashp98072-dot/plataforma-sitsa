import Link from "next/link";
import { redirect } from "next/navigation";
import { getColaboradorSession } from "@/lib/rrhh/colaborador-session";
import { listarPeriodos, listarLineas } from "@/lib/rrhh/planillas";

const ESTADOS_VISIBLES_COLABORADOR = ["Cerrada", "Pagada"];

function formatQ(valor: number): string {
  return `Q${valor.toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default async function BoletasPage() {
  const session = await getColaboradorSession();
  if (!session) {
    redirect("/portal/login");
  }

  const periodos = await listarPeriodos(session!.empresaId);
  const finalizados = periodos.filter((p) =>
    ESTADOS_VISIBLES_COLABORADOR.includes(p.estado),
  );

  const boletas: {
    periodoId: number;
    codigo: string;
    fechaInicio: string;
    fechaFin: string;
    neto: number;
    estadoPago: string;
  }[] = [];
  for (const periodo of finalizados) {
    const lineas = await listarLineas(session!.empresaId, periodo.id);
    const propia = lineas.find((l) => l.empleadoId === session!.empleadoId);
    if (!propia) continue;
    boletas.push({
      periodoId: periodo.id,
      codigo: periodo.codigo,
      fechaInicio: periodo.fechaInicio,
      fechaFin: periodo.fechaFin,
      neto: propia.neto,
      estadoPago: propia.estadoPago,
    });
  }
  boletas.sort((a, b) => (a.fechaInicio < b.fechaInicio ? 1 : -1));

  return (
    <main className="min-h-screen p-4 sm:p-8">
      <div className="mx-auto max-w-3xl">
        <Link href="/portal" className="text-sm text-[var(--muted)] hover:underline">
          ← Volver
        </Link>

        <header className="mt-4">
          <p className="text-sm uppercase tracking-[0.2em] text-[var(--muted)]">
            Boletas de pago
          </p>
          <h1 className="mt-1 text-2xl font-semibold">Mi historial</h1>
        </header>

        <Link href="/portal/boletas/resumen" className="mt-4 inline-block rounded-lg border border-[var(--accent)] px-4 py-2">Ver resumen mensual de pagos</Link>

        {boletas.length === 0 ? (
          <p className="mt-8 text-sm text-[var(--muted)]">
            Todavía no tienes boletas de pago cerradas para mostrar. Aparecerán
            aquí en cuanto RRHH cierre el periodo correspondiente.
          </p>
        ) : (
          <div className="mt-6 space-y-3">
            {boletas.map((b) => (
              <Link
                key={b.periodoId}
                href={`/portal/boletas/${b.periodoId}`}
                className="flex items-center justify-between rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 transition hover:border-[var(--accent)]"
              >
                <div>
                  <p className="font-medium">{b.codigo}</p>
                  <p className="mt-0.5 text-sm text-[var(--muted)]">
                    {b.fechaInicio} → {b.fechaFin}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-semibold">{formatQ(b.neto)}</p>
                  <p
                    className={`mt-0.5 text-xs ${
                      b.estadoPago === "Pagado"
                        ? "text-[#8fd4a0]"
                        : "text-[var(--muted)]"
                    }`}
                  >
                    {b.estadoPago}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
