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
  banco?: string | null;
  tipoCuenta?: string | null;
  cuentaBancaria?: string | null;
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
 * VIAT-3 — listado global de "Operaciones > Viáticos" (reemplaza el antiguo
 * "Control de Viáticos" de TMS, que era de solo lectura — VIAT-1 punto 7).
 * Reutiliza EXACTAMENTE el mismo endpoint (`/tms/viaticos/control`) y las
 * mismas transiciones de VIAT-1/VIAT-2 (autorizarViatico/liquidarViatico) —
 * no se crea ningún motor nuevo, solo se agregan selección + botones que
 * llaman los endpoints atómicos ya existentes uno por uno.
 *
 * Autorizar (individual y masivo) requiere `viaticos_autorizar:editar`.
 * Liquidar requiere `viaticos:editar`. Pagar/entregar vive en su propio
 * panel separado (ViaticosPorPagarPanel) — este NO lo duplica. Banco/
 * cuenta solo se muestran si el backend los incluyó en la respuesta
 * (`puedeVerBancario`) — nunca se piden ni se muestran por el cliente.
 */
export default function ViaticosControlPanel({ slug }: { slug: string }) {
  const [items, setItems] = useState<ViaticoControlRow[]>([]);
  const [resumen, setResumen] = useState<Resumen>({
    pendientes: 0,
    autorizados: 0,
    entregados: 0,
    liquidados: 0,
  });
  const [puedeAutorizar, setPuedeAutorizar] = useState(false);
  const [puedeLiquidar, setPuedeLiquidar] = useState(false);
  const [puedeVerBancario, setPuedeVerBancario] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [mensaje, setMensaje] = useState("");

  const [fBusqueda, setFBusqueda] = useState("");
  const [fEmpleado, setFEmpleado] = useState("");
  const [fRol, setFRol] = useState("");
  const [fMetodo, setFMetodo] = useState("");
  const [fFechaDesde, setFFechaDesde] = useState("");
  const [fFechaHasta, setFFechaHasta] = useState("");
  const [fEstado, setFEstado] = useState("");

  const [seleccionados, setSeleccionados] = useState<Set<number>>(new Set());
  const [accionandoId, setAccionandoId] = useState<number | null>(null);
  const [autorizandoMasivo, setAutorizandoMasivo] = useState(false);

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
        setError(data.error ?? "No se pudo cargar el listado de viáticos.");
        return;
      }
      setItems((data.items ?? []) as ViaticoControlRow[]);
      setResumen((data.resumen ?? resumen) as Resumen);
      setPuedeAutorizar(Boolean(data.puedeAutorizar));
      setPuedeLiquidar(Boolean(data.puedeLiquidar));
      setPuedeVerBancario(Boolean(data.puedeVerBancario));
      setSeleccionados(new Set());
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

  const filtrados = items.filter((r) => {
    if (fBusqueda.trim()) {
      const t = fBusqueda.trim().toLowerCase();
      const coincide =
        r.planCodigo.toLowerCase().includes(t) ||
        (r.cliente ?? "").toLowerCase().includes(t) ||
        r.personalNombre.toLowerCase().includes(t);
      if (!coincide) return false;
    }
    if (fRol && r.rol !== fRol) return false;
    if (fMetodo && r.metodoPago !== fMetodo) return false;
    return true;
  });

  function toggleSeleccion(id: number) {
    setSeleccionados((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSeleccionTodos() {
    setSeleccionados((prev) =>
      prev.size === filtrados.length ? new Set() : new Set(filtrados.map((r) => r.id)),
    );
  }

  async function autorizar(id: number) {
    setAccionandoId(id);
    setError("");
    setMensaje("");
    try {
      const res = await fetch(`/api/empresas/${slug}/tms/viaticos/${id}/autorizar`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "No se pudo autorizar el viático.");
        return;
      }
      setMensaje("Viático autorizado.");
      await cargar();
    } catch {
      setError("Error de conexión.");
    } finally {
      setAccionandoId(null);
    }
  }

  async function liquidar(id: number) {
    const observaciones = window.prompt("Observaciones de liquidación (opcional):") ?? undefined;
    setAccionandoId(id);
    setError("");
    setMensaje("");
    try {
      const res = await fetch(`/api/empresas/${slug}/tms/viaticos/${id}/liquidar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ observaciones: observaciones?.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "No se pudo liquidar el viático.");
        return;
      }
      setMensaje("Viático liquidado.");
      await cargar();
    } catch {
      setError("Error de conexión.");
    } finally {
      setAccionandoId(null);
    }
  }

  /**
   * "AUTORIZAR SELECCIONADOS" — llama el mismo endpoint atómico de a uno
   * por seleccionado (sin nuevo endpoint masivo en backend). Si alguno
   * falla (p. ej. ya no está PROGRAMADO), se reporta con nombre/motivo —
   * nunca se oculta un fallo parcial.
   */
  async function autorizarSeleccionados() {
    if (!seleccionados.size) {
      setError("Selecciona al menos un viático PROGRAMADO para autorizar.");
      return;
    }
    setAutorizandoMasivo(true);
    setError("");
    setMensaje("");
    const ids = [...seleccionados];
    const porId = new Map(items.map((r) => [r.id, r]));
    const fallos: string[] = [];
    let exitos = 0;
    for (const id of ids) {
      try {
        const res = await fetch(`/api/empresas/${slug}/tms/viaticos/${id}/autorizar`, { method: "POST" });
        const data = await res.json();
        if (!res.ok) {
          const nombre = porId.get(id)?.personalNombre ?? `#${id}`;
          fallos.push(`${nombre}: ${data.error ?? "error desconocido"}`);
        } else {
          exitos++;
        }
      } catch {
        const nombre = porId.get(id)?.personalNombre ?? `#${id}`;
        fallos.push(`${nombre}: error de conexión.`);
      }
    }
    if (exitos) setMensaje(`${exitos} viático(s) autorizado(s).`);
    if (fallos.length) {
      setError(`No se pudieron autorizar ${fallos.length}: ${fallos.join(" · ")}`);
    }
    setAutorizandoMasivo(false);
    await cargar();
  }

  return (
    <div className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
      <p className="text-xs text-[var(--muted)]">
        Listado global de viáticos (información interna). Autorizar requiere permiso de
        autorización; liquidar requiere el permiso general. El pago/entrega se hace desde la
        sección &quot;Viáticos por pagar&quot; más abajo.
      </p>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <button
          type="button"
          onClick={() => setFEstado(fEstado === "PROGRAMADO" ? "" : "PROGRAMADO")}
          className={`rounded border p-2 text-center transition ${fEstado === "PROGRAMADO" ? "border-sky-500 bg-sky-950/20" : "border-[var(--border)]"}`}
        >
          <p className="text-lg font-semibold">{resumen.pendientes}</p>
          <p className="text-[10px] text-[var(--muted)]">Programados</p>
        </button>
        <button
          type="button"
          onClick={() => setFEstado(fEstado === "AUTORIZADO" ? "" : "AUTORIZADO")}
          className={`rounded border p-2 text-center transition ${fEstado === "AUTORIZADO" ? "border-sky-500 bg-sky-950/20" : "border-[var(--border)]"}`}
        >
          <p className="text-lg font-semibold text-sky-300">{resumen.autorizados}</p>
          <p className="text-[10px] text-[var(--muted)]">Autorizados</p>
        </button>
        <button
          type="button"
          onClick={() => setFEstado(fEstado === "ENTREGADO" ? "" : "ENTREGADO")}
          className={`rounded border p-2 text-center transition ${fEstado === "ENTREGADO" ? "border-sky-500 bg-sky-950/20" : "border-[var(--border)]"}`}
        >
          <p className="text-lg font-semibold text-amber-300">{resumen.entregados}</p>
          <p className="text-[10px] text-[var(--muted)]">Entregados</p>
        </button>
        <button
          type="button"
          onClick={() => setFEstado(fEstado === "LIQUIDADO" ? "" : "LIQUIDADO")}
          className={`rounded border p-2 text-center transition ${fEstado === "LIQUIDADO" ? "border-sky-500 bg-sky-950/20" : "border-[var(--border)]"}`}
        >
          <p className="text-lg font-semibold text-emerald-300">{resumen.liquidados}</p>
          <p className="text-[10px] text-[var(--muted)]">Liquidados</p>
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-[var(--muted)]">
          Viaje / cliente / empleado
          <input className={`${inputCls} mt-0.5 block w-48`} value={fBusqueda} onChange={(e) => setFBusqueda(e.target.value)} />
        </label>
        <label className="text-xs text-[var(--muted)]">
          Empleado (servidor)
          <input className={`${inputCls} mt-0.5 block w-40`} value={fEmpleado} onChange={(e) => setFEmpleado(e.target.value)} />
        </label>
        <label className="text-xs text-[var(--muted)]">
          Rol
          <select className={`${inputCls} mt-0.5 block`} value={fRol} onChange={(e) => setFRol(e.target.value)}>
            <option value="">Todos</option>
            <option value="Piloto">Piloto</option>
            <option value="Auxiliar">Auxiliar</option>
          </select>
        </label>
        <label className="text-xs text-[var(--muted)]">
          Método de pago
          <select className={`${inputCls} mt-0.5 block`} value={fMetodo} onChange={(e) => setFMetodo(e.target.value)}>
            <option value="">Todos</option>
            <option value="EFECTIVO">Efectivo</option>
            <option value="TRANSFERENCIA">Transferencia</option>
            <option value="CHEQUE">Cheque</option>
          </select>
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
            <option value="PROGRAMADO">Programado</option>
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
        {puedeAutorizar ? (
          <button
            type="button"
            className="rounded bg-sky-700 px-3 py-1.5 text-xs text-white disabled:opacity-50"
            disabled={autorizandoMasivo || !seleccionados.size}
            onClick={() => void autorizarSeleccionados()}
          >
            {autorizandoMasivo ? "Autorizando…" : `Autorizar seleccionados${seleccionados.size ? ` (${seleccionados.size})` : ""}`}
          </button>
        ) : null}
      </div>

      {error ? <p className="text-xs text-red-300">{error}</p> : null}
      {mensaje ? <p className="text-xs text-emerald-300">{mensaje}</p> : null}

      <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-[#1F6AA5] text-white">
            <tr>
              {puedeAutorizar ? (
                <th className="px-2 py-2">
                  <input
                    type="checkbox"
                    checked={filtrados.length > 0 && seleccionados.size === filtrados.length}
                    onChange={toggleSeleccionTodos}
                  />
                </th>
              ) : null}
              <th className="px-3 py-2">Viaje</th>
              <th className="px-3 py-2">Fecha</th>
              <th className="px-3 py-2">Cliente</th>
              <th className="px-3 py-2">Empleado</th>
              <th className="px-3 py-2">Rol</th>
              <th className="px-3 py-2">Sugerido</th>
              <th className="px-3 py-2">Asignado</th>
              <th className="px-3 py-2">Estado</th>
              <th className="px-3 py-2">Método</th>
              {puedeVerBancario ? (
                <>
                  <th className="px-3 py-2">Banco</th>
                  <th className="px-3 py-2">Cuenta</th>
                </>
              ) : null}
              <th className="px-3 py-2">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {filtrados.map((r) => (
              <tr key={r.id} className="border-t border-[var(--border)]">
                {puedeAutorizar ? (
                  <td className="px-2 py-2">
                    <input type="checkbox" checked={seleccionados.has(r.id)} onChange={() => toggleSeleccion(r.id)} />
                  </td>
                ) : null}
                <td className="px-3 py-2">{r.planCodigo}</td>
                <td className="px-3 py-2">{r.fechaPlan}</td>
                <td className="px-3 py-2">{r.cliente ?? "—"}</td>
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
                {puedeVerBancario ? (
                  <>
                    <td className="px-3 py-2 text-[11px]">{r.banco || "—"}</td>
                    <td className="px-3 py-2 text-[11px]">
                      {r.cuentaBancaria ? `${r.cuentaBancaria}${r.tipoCuenta ? ` (${r.tipoCuenta})` : ""}` : "—"}
                    </td>
                  </>
                ) : null}
                <td className="px-3 py-2">
                  {puedeAutorizar && r.estado === "PROGRAMADO" ? (
                    <button
                      type="button"
                      disabled={accionandoId === r.id}
                      onClick={() => void autorizar(r.id)}
                      className="rounded bg-sky-700 px-2 py-1 text-xs text-white disabled:opacity-50"
                    >
                      {accionandoId === r.id ? "…" : "Autorizar"}
                    </button>
                  ) : null}
                  {puedeLiquidar && r.estado === "ENTREGADO" ? (
                    <button
                      type="button"
                      disabled={accionandoId === r.id}
                      onClick={() => void liquidar(r.id)}
                      className="rounded bg-emerald-700 px-2 py-1 text-xs text-white disabled:opacity-50"
                    >
                      {accionandoId === r.id ? "…" : "Liquidar"}
                    </button>
                  ) : null}
                  {!(puedeAutorizar && r.estado === "PROGRAMADO") && !(puedeLiquidar && r.estado === "ENTREGADO") ? (
                    <span className="text-[11px] text-[var(--muted)]">—</span>
                  ) : null}
                </td>
              </tr>
            ))}
            {!filtrados.length && !loading ? (
              <tr>
                <td colSpan={puedeAutorizar ? (puedeVerBancario ? 13 : 11) : puedeVerBancario ? 12 : 10} className="px-3 py-4 text-[var(--muted)]">
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
