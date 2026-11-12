"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ESTADO_SOLICITUD_LABELS,
  claseEstadoSolicitud,
  etiquetaEstadoSolicitud,
} from "@/lib/tms/solicitudes-cliente-ui";
import { formatearHora12 } from "@/lib/tms/hora-formato";
import {
  ETIQUETA_VINCULACION,
  claseVinculacion,
  requiereAtencion,
  textoResultadoVinculacion,
  type PriceSmartBandejaUi,
} from "@/lib/tms/pricesmart-bandeja-ui";

type SolicitudFila = {
  id: number;
  clienteId: number;
  clienteNombre: string;
  estado: string;
  fechaSolicitada: string;
  horaSolicitada: string | null;
  referenciaCliente: string | null;
  cantidadEntregas: number;
  planId: number | null;
  creadoEn: string;
};

export function SolicitudesClientesBandeja({ slug }: { slug: string }) {
  const [solicitudes, setSolicitudes] = useState<SolicitudFila[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [estado, setEstado] = useState("");
  const [cliente, setCliente] = useState("");
  const [fechaDesde, setFechaDesde] = useState("");
  const [fechaHasta, setFechaHasta] = useState("");
  // API-13 (laboratorio): anotaciones de PriceSmart. Fuera del laboratorio el servidor responde { enabled: false } y no se muestra nada.
  const [ps, setPs] = useState<PriceSmartBandejaUi>({ enabled: false });

  const cargarPriceSmart = useCallback(async () => {
    try {
      const res = await fetch(`/api/empresas/${slug}/tms/solicitudes-clientes/pricesmart`);
      if (res.ok) setPs((await res.json()) as PriceSmartBandejaUi);
    } catch {
      /* la bandeja funciona igual sin las anotaciones */
    }
  }, [slug]);

  const reconocer = useCallback(
    async (id: string) => {
      const res = await fetch(`/api/empresas/${slug}/tms/solicitudes-clientes/pricesmart/reconocer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (res.ok) await cargarPriceSmart();
    },
    [slug, cargarPriceSmart],
  );

  const cargar = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (estado) params.set("estado", estado);
      if (fechaDesde) params.set("fechaDesde", fechaDesde);
      if (fechaHasta) params.set("fechaHasta", fechaHasta);
      const res = await fetch(`/api/empresas/${slug}/tms/solicitudes-clientes?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "No se pudo cargar el listado.");
        return;
      }
      setSolicitudes(data.solicitudes ?? []);
    } finally {
      setLoading(false);
    }
  }, [slug, estado, fechaDesde, fechaHasta]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void cargar();
    void cargarPriceSmart();
  }, [cargar, cargarPriceSmart]);

  const origenPorId = useMemo(
    () => new Map((ps.enabled ? ps.origen : []).map((o) => [o.solicitudId, o])),
    [ps],
  );

  const visibles = useMemo(() => {
    const filtro = cliente.trim().toLowerCase();
    if (!filtro) return solicitudes;
    return solicitudes.filter((s) => s.clienteNombre.toLowerCase().includes(filtro));
  }, [solicitudes, cliente]);

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
        <input
          className="min-w-[180px] rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1.5 text-sm"
          placeholder="Buscar cliente…"
          value={cliente}
          onChange={(e) => setCliente(e.target.value)}
        />
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

      {ps.enabled && ps.pendientes.length ? (
        <div className="space-y-2 rounded-xl border border-[var(--border)] bg-[var(--card)] p-3" data-testid="pricesmart-pendientes">
          <p className="text-sm font-medium">Vinculaciones PriceSmart pendientes o fallidas</p>
          <ul className="space-y-1 text-xs">
            {ps.pendientes.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-2">
                <span className="font-mono">{p.referencia}</span>
                <span className={`rounded-full px-2 py-0.5 font-medium ${claseVinculacion(p.estado)}`}>{ETIQUETA_VINCULACION[p.estado]}</span>
                <span className="text-[var(--muted)]">
                  {p.intentos} intento(s) · {textoResultadoVinculacion(p)}
                </span>
                {requiereAtencion(p) ? (
                  <button type="button" className="rounded border border-[var(--border)] px-2 py-0.5 underline" onClick={() => void reconocer(p.id)}>
                    Reconocer
                  </button>
                ) : (
                  <span className="text-[var(--muted)]">Reconocida por {p.reconocidoPor}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {loading ? (
        <p className="text-sm text-[var(--muted)]">Cargando…</p>
      ) : (
        <div className="table-scroll rounded-xl border border-[var(--border)]">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-[var(--thead)] text-xs uppercase text-[var(--muted)]">
              <tr>
                <th className="px-3 py-2">#</th>
                <th className="px-3 py-2">Cliente</th>
                <th className="px-3 py-2">Fecha solicitada</th>
                <th className="px-3 py-2">Hora</th>
                <th className="px-3 py-2">Referencia</th>
                <th className="px-3 py-2">Entregas</th>
                <th className="px-3 py-2">Estado</th>
                <th className="px-3 py-2">Creada</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {visibles.map((s) => (
                <tr key={s.id} className="border-t border-[var(--border)]">
                  <td className="px-3 py-2 font-mono text-xs">#{s.id}</td>
                  <td className="px-3 py-2">{s.clienteNombre}</td>
                  <td className="px-3 py-2">{s.fechaSolicitada}</td>
                  <td className="px-3 py-2 text-xs">{formatearHora12(s.horaSolicitada)}</td>
                  <td className="px-3 py-2 text-xs">
                    {s.referenciaCliente || "—"}
                    {origenPorId.has(s.id) ? (
                      <span className="ml-1 rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] font-medium text-sky-500">PriceSmart</span>
                    ) : null}
                    {origenPorId.get(s.id)?.cancelacionPendiente ? (
                      <span className="ml-1 rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-medium text-red-500">Cancelación solicitada</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-xs">{s.cantidadEntregas}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-medium ${claseEstadoSolicitud(s.estado)}`}
                    >
                      {etiquetaEstadoSolicitud(s.estado)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs text-[var(--muted)]">
                    {s.creadoEn.slice(0, 16).replace("T", " ")}
                  </td>
                  <td className="px-3 py-2">
                    <Link
                      href={`/e/${slug}/tms/solicitudes-clientes/${s.id}`}
                      className="text-xs text-[var(--accent)] underline"
                    >
                      Revisar
                    </Link>
                  </td>
                </tr>
              ))}
              {!visibles.length ? (
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
