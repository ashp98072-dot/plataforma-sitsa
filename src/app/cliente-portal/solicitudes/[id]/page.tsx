import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getClienteSession } from "@/lib/tms/cliente-portal-session";
import { validarClienteSessionActiva } from "@/lib/tms/cliente-usuarios";
import { obtenerSolicitudCliente } from "@/lib/tms/solicitudes-cliente";
import {
  claseEstadoSolicitud,
  etiquetaEstadoSolicitud,
} from "@/lib/tms/solicitudes-cliente-ui";

type Props = { params: Promise<{ id: string }> };

/**
 * CLIENTE-PORTAL-2 (sección 11) — detalle de solicitud, server-side:
 * obtenerSolicitudCliente() ya filtra por empresaId+clienteId+id a la
 * vez y devuelve null tanto si no existe como si es de otro cliente —
 * en ambos casos, `notFound()` (nunca una página de "sin permiso" que
 * confirme que el id existe).
 */
export default async function DetalleSolicitudPage({ params }: Props) {
  const { id } = await params;
  const solicitudId = Number(id);
  if (!Number.isFinite(solicitudId) || solicitudId <= 0) notFound();

  const session = await getClienteSession();
  if (!session) redirect("/cliente-portal/login");
  const activa = await validarClienteSessionActiva(session!);
  if (!activa) redirect("/cliente-portal/login");

  const solicitud = await obtenerSolicitudCliente(
    session!.empresaId,
    session!.clienteId,
    solicitudId,
  );
  if (!solicitud) notFound();

  return (
    <main className="mx-auto max-w-3xl space-y-5 p-6">
      <Link href="/cliente-portal/solicitudes" className="text-xs text-[var(--muted)] underline">
        ← Mis solicitudes
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Solicitud #{solicitud.id}</h1>
        <span
          className={`rounded-full px-3 py-1.5 text-sm font-medium ${claseEstadoSolicitud(solicitud.estado)}`}
        >
          {etiquetaEstadoSolicitud(solicitud.estado)}
        </span>
      </div>

      {solicitud.estado === "RECHAZADA" && solicitud.motivoRechazo ? (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm">
          <p className="font-medium text-red-600 dark:text-red-300">Motivo del rechazo</p>
          <p className="mt-1 text-[var(--muted)]">{solicitud.motivoRechazo}</p>
        </div>
      ) : null}

      {solicitud.planId != null ? (
        <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm">
          <p className="font-medium text-emerald-700 dark:text-emerald-300">
            Esta solicitud ya fue programada.
          </p>
          <p className="mt-1 text-[var(--muted)]">
            Seguimiento disponible en la siguiente fase.
          </p>
        </div>
      ) : null}

      <section className="grid gap-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 sm:grid-cols-2">
        <Dato titulo="Fecha solicitada" valor={solicitud.fechaSolicitada} />
        <Dato titulo="Hora solicitada" valor={solicitud.horaSolicitada?.slice(0, 5) || "—"} />
        <Dato titulo="Referencia" valor={solicitud.referenciaCliente || "—"} />
        <Dato titulo="Cantidad de entregas" valor={String(solicitud.cantidadEntregas)} />
        <Dato titulo="Creado por" valor={solicitud.creadoPorNombre || "—"} />
        <Dato titulo="Fecha de creación" valor={solicitud.creadoEn.slice(0, 16).replace("T", " ")} />
        <div className="sm:col-span-2">
          <Dato titulo="Observaciones" valor={solicitud.observaciones || "—"} />
        </div>
      </section>

      <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <h2 className="font-medium">Recorrido</h2>
        <ol className="mt-3 space-y-2">
          {solicitud.paradas.map((p, i) => (
            <li key={p.id} className="flex items-start gap-3 text-sm">
              <span className="mt-0.5 shrink-0 rounded-full border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--muted)]">
                {p.tipo === "Carga" ? "Origen" : p.tipo === "Descarga" ? "Destino final" : `Entrega ${i}`}
              </span>
              <div>
                <p className="font-medium">{p.lugarNombre}</p>
                {p.referencia ? (
                  <p className="text-xs text-[var(--muted)]">{p.referencia}</p>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}

function Dato({ titulo, valor }: { titulo: string; valor: string }) {
  return (
    <div>
      <p className="text-xs text-[var(--muted)]">{titulo}</p>
      <p className="mt-0.5 text-sm font-medium">{valor}</p>
    </div>
  );
}
