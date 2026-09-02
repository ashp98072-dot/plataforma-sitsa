"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ESTADO_SOLICITUD_LABELS,
  claseEstadoSolicitud,
  etiquetaEstadoSolicitud,
} from "@/lib/tms/solicitudes-cliente-ui";
import { claseEstadoViaje, etiquetaEstadoViaje } from "@/lib/tms/cliente-portal-seguimiento-ui";

type SolicitudFila = {
  id: number;
  estado: string;
  fechaSolicitada: string;
  horaSolicitada: string | null;
  referenciaCliente: string | null;
  cantidadEntregas: number;
  planId: number | null;
  creadoEn: string;
  // CLIENTE-PORTAL-4 — aditivos, opcionales por compatibilidad con
  // cualquier caché/versión previa de la respuesta.
  planCodigo?: string | null;
  estadoViaje?: string | null;
};

export function MisSolicitudes() {
  const [solicitudes, setSolicitudes] = useState<SolicitudFila[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [estado, setEstado] = useState("");
  const [fechaDesde, setFechaDesde] = useState("");
  const [fechaHasta, setFechaHasta] = useState("");

  const cargar = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (estado) params.set("estado", estado);
      if (fechaDesde) params.set("fechaDesde", fechaDesde);
      if (fechaHasta) params.set("fechaHasta", fechaHasta);
      const res = await fetch(`/api/cliente-portal/solicitudes?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "No se pudo cargar el listado.");
        return;
      }
      setSolicitudes(data.solicitudes ?? []);
    } finally {
      setLoading(false);
    }
  }, [estado, fechaDesde, fechaHasta]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void cargar();
  }, [cargar]);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] p-3">
        <select
          className="rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1.5 text-sm"
          value={estado}
          onChange={(e) => setEstado(e.target.value)}
        >
          <option value="">Todos los estados</option>
          {Object.entries(ESTADO_SOLICITUD_LABELS).map(([valor, etiqueta]) => (
            <option key={valor} value={valor}>
              {etiqueta}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-xs text-[var(--muted)]">
          Desde
          <input
            type="date"
            className="rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1.5 text-sm"
            value={fechaDesde}
            onChange={(e) => setFechaDesde(e.target.value)}
          />
        </label>
        <label className="flex items-center gap-1 text-xs text-[var(--muted)]">
          Hasta
          <input
            type="date"
            className="rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1.5 text-sm"
            value={fechaHasta}
            onChange={(e) => setFechaHasta(e.target.value)}
          />
        </label>
      </div>

      {error ? <p className="text-sm text-red-500">{error}</p> : null}

      {loading ? (
        <p className="text-sm text-[var(--muted)]">Cargando…</p>
      ) : (
        <div className="table-scroll rounded-xl border border-[var(--border)]">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-[var(--thead)] text-xs uppercase text-[var(--muted)]">
              <tr>
                <th className="px-3 py-2">#</th>
                <th className="px-3 py-2">Fecha solicitada</th>
                <th className="px-3 py-2">Hora</th>
                <th className="px-3 py-2">Referencia</th>
                <th className="px-3 py-2">Entregas</th>
                <th className="px-3 py-2">Estado</th>
                <th className="px-3 py-2">Viaje</th>
                <th className="px-3 py-2">Creada</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {solicitudes.map((s) => (
                <tr key={s.id} className="border-t border-[var(--border)]">
                  <td className="px-3 py-2 font-mono text-xs">#{s.id}</td>
                  <td className="px-3 py-2">{s.fechaSolicitada}</td>
                  <td className="px-3 py-2 text-xs">{s.horaSolicitada?.slice(0, 5) || "—"}</td>
                  <td className="px-3 py-2 text-xs">{s.referenciaCliente || "—"}</td>
                  <td className="px-3 py-2 text-xs">{s.cantidadEntregas}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-medium ${claseEstadoSolicitud(s.estado)}`}
                    >
                      {etiquetaEstadoSolicitud(s.estado)}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {s.estadoViaje ? (
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-medium ${claseEstadoViaje(s.estadoViaje)}`}
                      >
                        {etiquetaEstadoViaje(s.estadoViaje)}
                      </span>
                    ) : (
                      <span className="text-xs text-[var(--muted)]">—</span>
                    )}
                    {s.planCodigo ? (
                      <p className="mt-0.5 text-[11px] text-[var(--muted)]">{s.planCodigo}</p>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-xs text-[var(--muted)]">
                    {s.creadoEn.slice(0, 16).replace("T", " ")}
                  </td>
                  <td className="px-3 py-2">
                    <Link
                      href={`/cliente-portal/solicitudes/${s.id}`}
                      className="text-xs text-[var(--accent)] underline"
                    >
                      Ver detalle
                    </Link>
                  </td>
                </tr>
              ))}
              {!solicitudes.length ? (
                <tr>
                  <td colSpan={9} className="px-3 py-6 text-center text-[var(--muted)]">
                    No hay solicitudes con este filtro.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
