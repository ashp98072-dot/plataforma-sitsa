import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getClienteSession } from "@/lib/tms/cliente-portal-session";
import { validarClienteSessionActiva } from "@/lib/tms/cliente-usuarios";
import { obtenerSeguimientoSolicitudCliente } from "@/lib/tms/cliente-portal-seguimiento";
import {
  claseEstadoViaje,
  etiquetaEstadoViaje,
} from "@/lib/tms/cliente-portal-seguimiento-ui";
import {
  claseEstadoSolicitud,
  etiquetaEstadoSolicitud,
} from "@/lib/tms/solicitudes-cliente-ui";
import { EvidenciasParada } from "./evidencias-parada";

type Props = { params: Promise<{ id: string }> };

/**
 * CLIENTE-PORTAL-2/4 (secciones 10-11) — detalle de solicitud + (si ya
 * fue programada) seguimiento del viaje real, server-side.
 * obtenerSeguimientoSolicitudCliente() ya encapsula la cadena completa
 * de autorización (empresaId+clienteId de sesión -> solicitud -> plan,
 * ver cliente-portal-seguimiento.ts) y devuelve null tanto si la
 * solicitud no existe como si es de otro cliente o el plan encontrado no
 * coincide en empresa/cliente — en todos los casos, `notFound()` (nunca
 * una página de "sin permiso" que confirme que el id existe).
 */
export default async function DetalleSolicitudPage({ params }: Props) {
  const { id } = await params;
  const solicitudId = Number(id);
  if (!Number.isFinite(solicitudId) || solicitudId <= 0) notFound();

  const session = await getClienteSession();
  if (!session) redirect("/cliente-portal/login");
  const activa = await validarClienteSessionActiva(session!);
  if (!activa) redirect("/cliente-portal/login");

  const seguimiento = await obtenerSeguimientoSolicitudCliente(
    session!.empresaId,
    session!.clienteId,
    solicitudId,
  );
  if (!seguimiento) notFound();
  const { solicitud, plan } = seguimiento;

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

      {plan ? (
        <section className="space-y-3 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium text-emerald-700 dark:text-emerald-300">
              Viaje: {plan.codigo}
            </p>
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-medium ${claseEstadoViaje(plan.estadoPortal)}`}
            >
              {etiquetaEstadoViaje(plan.estadoPortal)}
            </span>
          </div>
          <div className="grid gap-3 text-sm sm:grid-cols-3">
            <Dato titulo="Fecha del viaje" valor={plan.fechaPlan || "—"} />
            <Dato titulo="Piloto" valor={plan.pilotoNombre || "Sin asignar"} />
            <Dato titulo="Unidad" valor={plan.unidadPlaca || "Sin asignar"} />
          </div>
        </section>
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
        <h2 className="font-medium">{plan ? "Recorrido solicitado" : "Recorrido"}</h2>
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

      {plan ? (
        <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
          <h2 className="font-medium">Recorrido programado</h2>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Recorrido operativo actual del viaje — puede diferir del recorrido solicitado si
            Operaciones ajustó paradas al programar.
          </p>
          <ol className="mt-3 space-y-3">
            {plan.paradas.map((p, i) => (
              <li key={p.id} className="flex items-start gap-3 text-sm">
                <span
                  className={`mt-0.5 shrink-0 rounded-full border px-2 py-0.5 text-xs ${
                    p.completada
                      ? "border-emerald-500/40 text-emerald-700 dark:text-emerald-300"
                      : "border-[var(--border)] text-[var(--muted)]"
                  }`}
                >
                  {p.completada ? "✓" : "○"}{" "}
                  {p.tipo === "Carga" ? "Origen" : p.tipo === "Descarga" ? "Destino final" : `Entrega ${i}`}
                </span>
                <div className="flex-1">
                  <p className="font-medium">{p.lugarNombre}</p>
                  <div className="mt-1">
                    <EvidenciasParada
                      solicitudId={solicitud.id}
                      paradaId={p.id}
                      lugarNombre={p.lugarNombre}
                      cantidadEvidencias={p.cantidadEvidencias}
                    />
                    {!p.cantidadEvidencias ? (
                      <span className="text-xs text-[var(--muted)]">Sin evidencia aún.</span>
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
            {!plan.paradas.length ? (
              <p className="text-sm text-[var(--muted)]">Este viaje aún no tiene paradas.</p>
            ) : null}
          </ol>
        </section>
      ) : null}
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
