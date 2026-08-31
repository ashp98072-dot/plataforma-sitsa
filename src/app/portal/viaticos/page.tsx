import Link from "next/link";
import { redirect } from "next/navigation";
import { getColaboradorSession } from "@/lib/rrhh/colaborador-session";
import { listarHistorialViaticosPropios } from "@/lib/rrhh/viaticos-portal";

const estados: Record<string, string> = {
  PROGRAMADO: "Programado", AUTORIZADO: "Autorizado / pendiente de entrega",
  // VIATICOS-RECHAZADO-1 (sección 15) — el colaborador SÍ debe ver que su
  // viático fue rechazado, con fecha y motivo (ver render abajo).
  RECHAZADO: "Rechazado",
  ENTREGADO: "Entregado", LIQUIDADO: "Liquidado",
};

export default async function ViaticosPage({ searchParams }: { searchParams: Promise<{ pagina?: string }> }) {
  const session = await getColaboradorSession();
  if (!session) redirect("/portal/login");
  const { pagina: valor } = await searchParams;
  const pagina = Math.max(1, Math.min(10000, Math.trunc(Number(valor)) || 1));
  const { items, hayMas } = await listarHistorialViaticosPropios(session.empresaId, session.empleadoId, pagina);
  return (
    <main className="min-h-screen p-4 sm:p-8">
      <div className="mx-auto max-w-3xl space-y-5">
        <Link href="/portal" className="text-sm underline">← Volver</Link>
        <header>
          <h1 className="text-2xl font-semibold">Mis viáticos</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">Viáticos asignados e historial de entregas de tus viajes como piloto o auxiliar. Solo se muestran tus montos.</p>
          <p className="mt-1 text-xs text-[var(--muted)]">Programado o autorizado no significa entregado. La entrega la registra Operaciones.</p>
        </header>
        {items.length === 0 ? <p>No hay viáticos vinculados a tu usuario en esta página. Si ya tienes una asignación, solicita a Operaciones verificar que tu registro de TMS esté vinculado a tu ficha de empleado.</p> : items.map((v) => (
          <section key={v.id} className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
            <div className="flex flex-wrap justify-between gap-2">
              <Link className="font-semibold underline" href={`/portal/viajes?viaje=${v.planId}`}>{v.codigo}</Link>
              <span>{estados[v.estado] ?? v.estado}</span>
            </div>
            <p className="mt-2 text-sm">Fecha del viaje: {v.fecha.split("-").reverse().join("/")}</p>
            <p className="mt-2 font-semibold">Viático asignado: {v.monto.toLocaleString("es-GT", { style: "currency", currency: "GTQ" })}</p>
            {v.estado === "RECHAZADO" ? (
              <div className="mt-2 rounded-lg border border-red-900/40 bg-red-950/10 p-3 text-sm">
                <p className="font-medium text-red-300">Este viático fue rechazado.</p>
                {v.rechazado ? <p className="mt-1">Fecha: {v.rechazado}</p> : null}
                {v.motivoRechazo ? <p className="mt-1">Motivo: {v.motivoRechazo}</p> : null}
              </div>
            ) : (
              <>
                <p className="mt-2 text-sm">Entregado: {v.entregado ?? "Pendiente"}</p>
                {v.liquidado ? <p className="text-sm">Liquidado: {v.liquidado}</p> : null}
              </>
            )}
          </section>
        ))}
        <nav className="flex gap-4 text-sm">
          {pagina > 1 ? <Link className="underline" href={`/portal/viaticos?pagina=${pagina - 1}`}>Anterior</Link> : null}
          <span>Página {pagina}</span>
          {hayMas ? <Link className="underline" href={`/portal/viaticos?pagina=${pagina + 1}`}>Siguiente</Link> : null}
        </nav>
      </div>
    </main>
  );
}
