"use client";

import { useCallback, useEffect, useState } from "react";

type ViaticoControlRow = {
  id: number;
  planId: number;
  planCodigo: string;
  fechaPlan: string;
  cliente: string | null;
  personalNombre: string;
  rol: string;
  montoSugerido: number;
  montoAsignado: number;
  estado: string;
  metodoPago: string | null;
  referenciaPago: string | null;
};

type Resumen = {
  pendientes: number;
  autorizados: number;
  entregados: number;
  liquidados: number;
};

function q(n: number): string {
  return `Q${n.toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const inputCls =
  "rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1.5 text-sm";

const ESTADO_BADGE_CLS: Record<string, string> = {
  PROGRAMADO: "bg-[var(--input)] text-[var(--muted)]",
  AUTORIZADO: "bg-sky-950/40 text-sky-300",
  ENTREGADO: "bg-amber-950/40 text-amber-300",
  LIQUIDADO: "bg-emerald-950/40 text-emerald-300",
};

const METODO_PAGO_LABEL: Record<string, string> = {
  EFECTIVO: "Efectivo",
  TRANSFERENCIA: "Transferencia",
  CHEQUE: "Cheque",
};

/**
 * VIAT-1 (punto 7) — "Control de Viáticos": vista administrativa de solo
 * lectura + resumen, filtrable por viaje/cliente (texto libre sobre el
 * resultado ya cargado), fecha, empleado y estado. Las acciones de
 * autorizar/entregar/liquidar se hacen desde Programación (ViaticosPanel,
 * dentro de cada viaje) — este panel NO duplica ese formulario, es
 * únicamente para supervisión general. Requiere permiso `viaticos:ver`
 * (el propio endpoint /tms/viaticos/control lo exige).
 */
export default function ViaticosControlPanel({ slug }: { slug: string }) {
  const [items, setItems] = useState<ViaticoControlRow[]>([]);
  const [resumen, setResumen] = useState<Resumen>({
    pendientes: 0,
    autorizados: 0,
    entregados: 0,
    liquidados: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [fBusqueda, setFBusqueda] = useState("");
  const [fFechaDesde, setFFechaDesde] = useState("");
  const [fFechaHasta, setFFechaHasta] = useState("");
  const [fEmpleado, setFEmpleado] = useState("");
  const [fEstado, setFEstado] = useState("");

  const cargar = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (fFechaDesde) params.set("fechaDesde", fFechaDesde);
      if (fFechaHasta) params.set("fechaHasta", fFechaHasta);
      if (fEmpleado.trim()) params.set("empleado", fEmpleado.trim());
      if (fEstado) params.set("estado", fEstado);
      const res = await fetch(`/api/empresas/${slug}/tms/viaticos/control?${params.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "No se pudo cargar el control de viáticos.");
        return;
      }
      setItems((data.items ?? []) as ViaticoControlRow[]);
      setResumen((data.resumen ?? resumen) as Resumen);
    } catch {
      setError("Error de conexión.");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, fFechaDesde, fFechaHasta, fEmpleado, fEstado]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void cargar();
  }, [cargar]);

  const filtrados = fBusqueda.trim()
    ? items.filter((r) => {
        const t = fBusqueda.trim().toLowerCase();
        return (
          r.planCodigo.toLowerCase().includes(t) ||
          (r.cliente ?? "").toLowerCase().includes(t)
        );
      })
    : items;

  return (
    <div className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
      <p className="text-xs text-[var(--muted)]">
        Supervisión general de viáticos (información interna). Para autorizar, registrar entrega o
        liquidar un viático, ábrelo desde el viaje correspondiente en Programación.
      </p>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded border border-[var(--border)] p-2 text-center">
          <p className="text-lg font-semibold">{resumen.pendientes}</p>
          <p className="text-[10px] text-[var(--muted)]">Pendientes</p>
        </div>
        <div className="rounded border border-[var(--border)] p-2 text-center">
          <p className="text-lg font-semibold text-sky-300">{resumen.autorizados}</p>
          <p className="text-[10px] text-[var(--muted)]">Autorizados</p>
        </div>
        <div className="rounded border border-[var(--border)] p-2 text-center">
          <p className="text-lg font-semibold text-amber-300">{resumen.entregados}</p>
          <p className="text-[10px] text-[var(--muted)]">Entregados</p>
        </div>
        <div className="rounded border border-[var(--border)] p-2 text-center">
          <p className="text-lg font-semibold text-emerald-300">{resumen.liquidados}</p>
          <p className="text-[10px] text-[var(--muted)]">Liquidados</p>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-[var(--muted)]">
          Viaje / cliente
          <input className={`${inputCls} mt-0.5 block w-40`} value={fBusqueda} onChange={(e) => setFBusqueda(e.target.value)} />
        </label>
        <label className="text-xs text-[var(--muted)]">
          Empleado
          <input className={`${inputCls} mt-0.5 block w-40`} value={fEmpleado} onChange={(e) => setFEmpleado(e.target.value)} />
        </label>
        <label className="text-xs text-[var(--muted)]">
          Desde
          <input type="date" className={`${inputCls} mt-0.5 block`} value={fFechaDesde} onChange={(e) => setFFechaDesde(e.target.value)} />
        </label>
        <label className="text-xs text-[var(--muted)]">
          Hasta
          <input type="date" className={`${inputCls} mt-0.5 block`} value={fFechaHasta} onChange={(e) => setFFechaHasta(e.target.value)} />
        </label>
        <label className="text-xs text-[var(--muted)]">
          Estado
          <select className={`${inputCls} mt-0.5 block`} value={fEstado} onChange={(e) => setFEstado(e.target.value)}>
            <option value="">Todos</option>
            <option value="PROGRAMADO">Pendiente</option>
            <option value="AUTORIZADO">Autorizado</option>
            <option value="ENTREGADO">Entregado</option>
            <option value="LIQUIDADO">Liquidado</option>
          </select>
        </label>
        <button
          type="button"
          className="rounded bg-[#334155] px-3 py-1.5 text-xs text-white"
          disabled={loading}
          onClick={() => void cargar()}
        >
          {loading ? "Actualizando…" : "Actualizar"}
        </button>
      </div>

      {error ? <p className="text-xs text-red-300">{error}</p> : null}

      <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-[#1F6AA5] text-white">
            <tr>
              <th className="px-3 py-2">Viaje</th>
              <th className="px-3 py-2">Fecha</th>
              <th className="px-3 py-2">Empleado</th>
              <th className="px-3 py-2">Rol</th>
              <th className="px-3 py-2">Sugerido</th>
              <th className="px-3 py-2">Asignado</th>
              <th className="px-3 py-2">Estado</th>
              <th className="px-3 py-2">Método</th>
              <th className="px-3 py-2">Referencia</th>
            </tr>
          </thead>
          <tbody>
            {filtrados.map((r) => (
              <tr key={r.id} className="border-t border-[var(--border)]">
                <td className="px-3 py-2">
                  {r.planCodigo} {r.cliente ? <span className="text-[var(--muted)]">· {r.cliente}</span> : null}
                </td>
                <td className="px-3 py-2">{r.fechaPlan}</td>
                <td className="px-3 py-2">{r.personalNombre}</td>
                <td className="px-3 py-2">{r.rol}</td>
                <td className="px-3 py-2">{q(r.montoSugerido)}</td>
                <td className="px-3 py-2">{q(r.montoAsignado)}</td>
                <td className="px-3 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${ESTADO_BADGE_CLS[r.estado] ?? ""}`}>
                    {r.estado}
                  </span>
                </td>
                <td className="px-3 py-2">{r.metodoPago ? METODO_PAGO_LABEL[r.metodoPago] ?? r.metodoPago : "—"}</td>
                <td className="px-3 py-2">{r.referenciaPago || "—"}</td>
              </tr>
            ))}
            {!filtrados.length && !loading ? (
              <tr>
                <td colSpan={9} className="px-3 py-4 text-[var(--muted)]">
                  Sin viáticos con este filtro.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
