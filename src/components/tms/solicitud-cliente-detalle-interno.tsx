"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  claseEstadoSolicitud,
  etiquetaEstadoSolicitud,
} from "@/lib/tms/solicitudes-cliente-ui";

type ParadaDetalle = {
  id: number;
  orden: number;
  tipo: string;
  lugarNombre: string;
  referencia: string | null;
};

type SolicitudDetalle = {
  id: number;
  clienteId: number;
  clienteNombre: string;
  estado: string;
  fechaSolicitada: string;
  horaSolicitada: string | null;
  referenciaCliente: string | null;
  observaciones: string | null;
  motivoRechazo: string | null;
  planId: number | null;
  planCodigo: string | null;
  version: number;
  creadoPorNombre: string | null;
  creadoEn: string;
  cantidadEntregas: number;
  paradas: ParadaDetalle[];
};

/**
 * CLIENTE-PORTAL-3 (alcance 13) — acciones internas según estado:
 *  SOLICITADA   -> [Tomar en revisión] [Rechazar]
 *  EN_REVISION  -> [Programar viaje] [Rechazar]
 *  PROGRAMADA   -> "Plan de viaje: <código>" + [Ver plan de viaje]
 *  RECHAZADA    -> motivo
 * El cliente NUNCA puede disparar ninguna de estas transiciones — solo
 * existen aquí, en la bandeja interna, detrás de
 * requireTenantProgramacion.
 */
export function SolicitudClienteDetalleInterno({
  slug,
  solicitudId,
}: {
  slug: string;
  solicitudId: number;
}) {
  const [solicitud, setSolicitud] = useState<SolicitudDetalle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [accionEnCurso, setAccionEnCurso] = useState(false);
  const [mostrarRechazo, setMostrarRechazo] = useState(false);
  const [motivo, setMotivo] = useState("");

  const base = `/api/empresas/${slug}/tms/solicitudes-clientes/${solicitudId}`;

  const cargar = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(base);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "No se pudo cargar la solicitud.");
        setSolicitud(null);
        return;
      }
      setSolicitud(data.solicitud);
    } finally {
      setLoading(false);
    }
  }, [base]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void cargar();
  }, [cargar]);

  async function onRevisar() {
    if (!solicitud || accionEnCurso) return;
    setAccionEnCurso(true);
    setError("");
    try {
      const res = await fetch(base, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accion: "revisar", version: solicitud.version }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "No se pudo tomar en revisión.");
        return;
      }
      await cargar();
    } finally {
      setAccionEnCurso(false);
    }
  }

  async function onRechazar() {
    if (!solicitud || accionEnCurso || motivo.trim().length < 5) return;
    setAccionEnCurso(true);
    setError("");
    try {
      const res = await fetch(base, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accion: "rechazar", version: solicitud.version, motivo }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "No se pudo rechazar la solicitud.");
        return;
      }
      setMostrarRechazo(false);
      setMotivo("");
      await cargar();
    } finally {
      setAccionEnCurso(false);
    }
  }

  async function onProgramar() {
    if (!solicitud || accionEnCurso) return;
    setAccionEnCurso(true);
    setError("");
    try {
      const res = await fetch(`${base}/programar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: solicitud.version }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "No se pudo programar la solicitud.");
        return;
      }
      await cargar();
    } finally {
      setAccionEnCurso(false);
    }
  }

  if (loading) return <p className="text-sm text-[var(--muted)]">Cargando…</p>;
  if (!solicitud) {
    return <p className="text-sm text-red-500">{error || "Solicitud no encontrada."}</p>;
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">
          Solicitud #{solicitud.id} — {solicitud.clienteNombre}
        </h1>
        <span
          className={`rounded-full px-3 py-1.5 text-sm font-medium ${claseEstadoSolicitud(solicitud.estado)}`}
        >
          {etiquetaEstadoSolicitud(solicitud.estado)}
        </span>
      </div>

      {error ? <p className="text-sm text-red-500">{error}</p> : null}

      <section className="grid gap-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 sm:grid-cols-2">
        <Dato titulo="Cliente" valor={solicitud.clienteNombre} />
        <Dato titulo="Usuario que creó la solicitud" valor={solicitud.creadoPorNombre || "—"} />
        <Dato titulo="Fecha solicitada" valor={solicitud.fechaSolicitada} />
        <Dato titulo="Hora solicitada" valor={solicitud.horaSolicitada?.slice(0, 5) || "—"} />
        <Dato titulo="Referencia" valor={solicitud.referenciaCliente || "—"} />
        <Dato titulo="Cantidad de entregas" valor={String(solicitud.cantidadEntregas)} />
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

      <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        {solicitud.estado === "SOLICITADA" ? (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={accionEnCurso}
              onClick={onRevisar}
              className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              Tomar en revisión
            </button>
            <button
              type="button"
              disabled={accionEnCurso}
              onClick={() => setMostrarRechazo(true)}
              className="rounded-lg border border-red-500/50 px-4 py-2 text-sm text-red-600 disabled:opacity-60"
            >
              Rechazar
            </button>
          </div>
        ) : null}

        {solicitud.estado === "EN_REVISION" ? (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={accionEnCurso}
              onClick={onProgramar}
              className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              {accionEnCurso ? "Programando…" : "Programar viaje"}
            </button>
            <button
              type="button"
              disabled={accionEnCurso}
              onClick={() => setMostrarRechazo(true)}
              className="rounded-lg border border-red-500/50 px-4 py-2 text-sm text-red-600 disabled:opacity-60"
            >
              Rechazar
            </button>
          </div>
        ) : null}

        {mostrarRechazo ? (
          <div className="mt-3 space-y-2 rounded-lg border border-[var(--border)] p-3">
            <label className="block text-sm">
              Motivo del rechazo *
              <textarea
                rows={3}
                maxLength={500}
                className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1.5 text-sm"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
              />
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={accionEnCurso || motivo.trim().length < 5}
                onClick={onRechazar}
                className="rounded-lg bg-red-600 px-3 py-1.5 text-sm text-white disabled:opacity-60"
              >
                Confirmar rechazo
              </button>
              <button
                type="button"
                onClick={() => {
                  setMostrarRechazo(false);
                  setMotivo("");
                }}
                className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm"
              >
                Cancelar
              </button>
            </div>
          </div>
        ) : null}

        {solicitud.estado === "PROGRAMADA" ? (
          <div className="space-y-2 text-sm">
            <p>
              Plan de viaje:{" "}
              <span className="font-mono font-medium">{solicitud.planCodigo ?? `#${solicitud.planId}`}</span>
            </p>
            <p>Estado: Programada</p>
            {solicitud.planId != null ? (
              <Link
                href={`/e/${slug}/programacion?plan=${solicitud.planId}`}
                className="inline-block rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white"
              >
                Ver plan de viaje
              </Link>
            ) : null}
          </div>
        ) : null}

        {solicitud.estado === "RECHAZADA" ? (
          <div className="text-sm">
            <p className="font-medium text-red-600 dark:text-red-300">Motivo del rechazo</p>
            <p className="mt-1 text-[var(--muted)]">{solicitud.motivoRechazo || "—"}</p>
          </div>
        ) : null}
      </section>
    </div>
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
