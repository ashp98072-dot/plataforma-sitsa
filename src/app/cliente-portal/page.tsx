import Link from "next/link";
import { redirect } from "next/navigation";
import { getClienteSession } from "@/lib/tms/cliente-portal-session";
import { obtenerNombreCliente } from "@/lib/tms/cliente-portal-datos";
import { validarClienteSessionActiva } from "@/lib/tms/cliente-usuarios";
import { resumenSolicitudesCliente } from "@/lib/tms/solicitudes-cliente";
import { resumenSeguimientoCliente } from "@/lib/tms/cliente-portal-seguimiento";
import {
  claseEstadoSolicitud,
  etiquetaEstadoSolicitud,
} from "@/lib/tms/solicitudes-cliente-ui";
import ClientePortalLogoutButton from "./logout-button";

/**
 * CLIENTE-PORTAL-2/4 (sección 7 / sección 14) — dashboard real del
 * Portal del Cliente. "Actividad reciente" sigue en
 * resumenSolicitudesCliente() (sin cambios, CLIENTE-PORTAL-2). Las
 * tarjetas de arriba ahora usan resumenSeguimientoCliente() (CLIENTE-
 * PORTAL-4) — mismo criterio "no segunda fuente de verdad": está
 * construido sobre listarViajesCliente(), que a su vez reutiliza
 * listarSolicitudesCliente(). Ningún viaje se cuenta dos veces (ver
 * cliente-portal-seguimiento.ts).
 */
export default async function ClientePortalHomePage() {
  const session = await getClienteSession();
  if (!session) redirect("/cliente-portal/login");
  const activa = await validarClienteSessionActiva(session!);
  if (!activa) redirect("/cliente-portal/login");

  const [nombreCliente, resumen, resumenViajes] = await Promise.all([
    obtenerNombreCliente(session!.empresaId, session!.clienteId),
    resumenSolicitudesCliente(session!.empresaId, session!.clienteId),
    resumenSeguimientoCliente(session!.empresaId, session!.clienteId),
  ]);

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
            Grupo SITSA
          </p>
          <h1 className="mt-1 text-2xl font-semibold">Portal del Cliente</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Cliente: <span className="font-medium">{nombreCliente ?? "—"}</span>
            {" · "}
            Usuario: <span className="font-medium">{session!.nombre ?? "—"}</span>
          </p>
        </div>
        <ClientePortalLogoutButton />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Tarjeta titulo="Solicitudes pendientes" valor={resumenViajes.pendientes} />
        <Tarjeta titulo="Viajes programados" valor={resumenViajes.viajesProgramados} />
        <Tarjeta titulo="Viajes en ruta" valor={resumenViajes.viajesEnRuta} />
        <Tarjeta titulo="Viajes finalizados" valor={resumenViajes.viajesFinalizados} />
        <Tarjeta titulo="Rechazadas / canceladas" valor={resumenViajes.rechazadasCanceladas} />
        <Tarjeta titulo="Total de solicitudes" valor={resumenViajes.total} />
      </div>

      <div className="flex flex-wrap gap-3">
        <Link
          href="/cliente-portal/solicitudes/nueva"
          className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:brightness-110"
        >
          + Nueva solicitud
        </Link>
        <Link
          href="/cliente-portal/solicitudes"
          className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm hover:bg-[var(--input)]"
        >
          Mis solicitudes
        </Link>
      </div>

      <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <h2 className="font-medium">Actividad reciente</h2>
        {resumen.recientes.length ? (
          <ul className="mt-3 divide-y divide-[var(--border)]">
            {resumen.recientes.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <div>
                  <Link
                    href={`/cliente-portal/solicitudes/${s.id}`}
                    className="font-medium text-[var(--accent)] underline"
                  >
                    Solicitud #{s.id}
                  </Link>
                  <p className="text-xs text-[var(--muted)]">
                    Fecha solicitada: {s.fechaSolicitada} · {s.cantidadEntregas} entrega(s)
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${claseEstadoSolicitud(s.estado)}`}
                >
                  {etiquetaEstadoSolicitud(s.estado)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-[var(--muted)]">
            Todavía no has enviado ninguna solicitud.
          </p>
        )}
      </section>
    </main>
  );
}

function Tarjeta({ titulo, valor }: { titulo: string; valor: number }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
      <p className="text-2xl font-semibold">{valor}</p>
      <p className="mt-1 text-xs text-[var(--muted)]">{titulo}</p>
    </div>
  );
}
