"use client";

import { useCallback, useEffect, useState } from "react";
import {
  coincideCuentaBancaria,
  coincideMetodoPago,
  totalSeleccionado,
  type FiltroCuentaBancaria,
  type FiltroMetodoPago,
} from "@/lib/tms/viaticos-filtros-ui";
import HistorialFirmasModal from "@/components/tms/historial-firmas-modal";

type ViaticoPorPagarRow = {
  id: number;
  planId: number;
  planCodigo: string;
  fechaPlan: string;
  personalCodigo: string | null;
  personalNombre: string;
  rol: string;
  montoAsignado: number;
  estado: string;
  metodoPago: string | null;
  referenciaPago: string | null;
  banco: string | null;
  tipoCuenta: string | null;
  cuentaBancaria: string | null;
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
 * VIAT-2 (punto 3) — "Viáticos por pagar": bandeja de trabajo del
 * facturador. Distinta del Control de Viáticos general de TMS (ese es de
 * Operaciones, solo lectura, sin dato bancario) — esta muestra el dato
 * bancario ya existente del empleado (banco/cuenta/tipo de cuenta) porque
 * solo la ve quien tiene el permiso `viaticos_pagar` (lo exige el propio
 * endpoint). No se mezcla con Facturación de clientes: el "facturador"
 * aquí es un usuario interno de la empresa con este permiso, no el
 * cliente ni el módulo de Facturación.
 *
 * VIAT-2b — el archivo bancario ahora usa el layout REAL de Bi Banking
 * (5 columnas, sin encabezado, Windows-1252 — ver
 * src/lib/tms/viaticos-exportar-banco.ts) y se genera solo si TODOS los
 * seleccionados pasan validación; si no, se muestra la lista de problemas
 * en vez de descargar algo. Generar/descargar es de solo lectura: nunca
 * cambia AUTORIZADO → ENTREGADO por sí solo (eso requiere confirmar
 * "Registrar entrega/pago" en la fila correspondiente).
 */
export default function ViaticosPorPagarPanel({ slug }: { slug: string }) {
  const [items, setItems] = useState<ViaticoPorPagarRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [mensaje, setMensaje] = useState("");

  const [fBusqueda, setFBusqueda] = useState("");
  const [fFechaDesde, setFFechaDesde] = useState("");
  const [fFechaHasta, setFFechaHasta] = useState("");
  const [fEmpleado, setFEmpleado] = useState("");
  const [fEstado, setFEstado] = useState("AUTORIZADO");
  // VIATICOS-BANDEJAS-1 — filtros SOLO client-side (mismo criterio que
  // fBusqueda ya existente: no viajan al servidor, listarViaticosPorPagar
  // no los soporta — no se toca el backend). Valores REALES de
  // metodo_pago (nunca "BANCO" como valor interno, ver ticket).
  const [fMetodo, setFMetodo] = useState<FiltroMetodoPago>("");
  const [fCuenta, setFCuenta] = useState<FiltroCuentaBancaria>("");

  const [seleccionados, setSeleccionados] = useState<Set<number>>(new Set());
  const [pagandoId, setPagandoId] = useState<number | null>(null);
  const [metodoPago, setMetodoPago] = useState<Record<number, string>>({});
  const [referenciaPago, setReferenciaPago] = useState<Record<number, string>>({});
  const [obsEntrega, setObsEntrega] = useState<Record<number, string>>({});

  // VIATICOS-HISTORIAL-FIRMA-1 (sección 12) — permite al Facturador
  // confirmar quién autorizó (nombre/fecha/firma visual) ANTES de pagar,
  // sin darle ningún permiso de autorizar/liquidar: es el mismo modal de
  // solo lectura de ViaticosControlPanel, reutilizado tal cual.
  const [verFirmasDe, setVerFirmasDe] = useState<ViaticoPorPagarRow | null>(null);

  // VIAT-2b — archivo Bi Banking: se genera vía fetch (no un <a href> plano)
  // porque el endpoint puede responder 400 con la lista de problemas en vez
  // del archivo — generar/descargar NUNCA cambia estado, solo valida y lee.
  const [tipoOperacion, setTipoOperacion] = useState("1");
  const [generandoBanco, setGenerandoBanco] = useState(false);
  const [problemasBanco, setProblemasBanco] = useState<
    { id: number; planCodigo: string; personalNombre: string; motivo: string }[]
  >([]);

  const queryFiltros = useCallback(() => {
    const params = new URLSearchParams();
    if (fFechaDesde) params.set("fechaDesde", fFechaDesde);
    if (fFechaHasta) params.set("fechaHasta", fFechaHasta);
    if (fEmpleado.trim()) params.set("empleado", fEmpleado.trim());
    params.set("estado", fEstado || "AUTORIZADO");
    return params;
  }, [fFechaDesde, fFechaHasta, fEmpleado, fEstado]);

  const cargar = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/empresas/${slug}/tms/viaticos/por-pagar?${queryFiltros().toString()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "No se pudo cargar la bandeja de viáticos por pagar.");
        return;
      }
      setItems((data.items ?? []) as ViaticoPorPagarRow[]);
      setSeleccionados(new Set());
    } catch {
      setError("Error de conexión.");
    } finally {
      setLoading(false);
    }
  }, [slug, queryFiltros]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void cargar();
  }, [cargar]);

  // VIATICOS-BANDEJAS-1 — los 3 filtros client-side se combinan con AND
  // (sección 5 del ticket: deben cumplir TODO, nunca OR).
  const filtrados = items.filter((r) => {
    if (fBusqueda.trim() && !r.planCodigo.toLowerCase().includes(fBusqueda.trim().toLowerCase())) return false;
    if (!coincideMetodoPago(r.metodoPago, fMetodo)) return false;
    if (!coincideCuentaBancaria(r.cuentaBancaria, fCuenta)) return false;
    return true;
  });

  // VIATICOS-BANDEJAS-1 — igual que en ViaticosControlPanel: fBusqueda/
  // fMetodo/fCuenta son client-side y no recargan (a diferencia de
  // fEstado/fFechaDesde/fFechaHasta/fEmpleado, que sí recargan vía
  // cargar() y ya limpian la selección ahí). generarArchivoBancario()/
  // urlExportar() actúan sobre `seleccionados` en crudo — se limpia la
  // selección completa al cambiar cualquiera de estos filtros para que
  // nunca se genere un archivo bancario ni se exporte algo que dejó de
  // estar a la vista.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSeleccionados(new Set());
  }, [fBusqueda, fMetodo, fCuenta]);

  const { cantidad: cantidadSeleccionada, monto: montoSeleccionado } = totalSeleccionado(filtrados, seleccionados);

  // VIAT-4 (punto 11) — antes de exportar el archivo bancario: cuántos
  // AUTORIZADOS realmente calificarían (cuenta bancaria + monto > 0) y
  // cuántos no tienen cuenta — para que el facturador no descubra la
  // exclusión recién al intentar generar el archivo. Los que no tienen
  // cuenta NO se ocultan de la tabla: siguen disponibles para pagarse por
  // otro método (efectivo/cheque) vía "Registrar entrega/pago".
  const autorizadosVisibles = filtrados.filter((r) => r.estado === "AUTORIZADO");
  const aptosBanco = autorizadosVisibles.filter((r) => r.cuentaBancaria?.trim() && r.montoAsignado > 0);
  const sinCuentaBanco = autorizadosVisibles.filter((r) => !r.cuentaBancaria?.trim());

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

  function urlExportar(formato: "xlsx" | "banco"): string {
    const params = queryFiltros();
    params.set("formato", formato);
    if (seleccionados.size) params.set("ids", [...seleccionados].join(","));
    if (formato === "banco") params.set("tipo", tipoOperacion.trim() || "1");
    return `/api/empresas/${slug}/tms/viaticos/por-pagar/exportar?${params.toString()}`;
  }

  /**
   * Descarga el archivo Bi Banking. Si el servidor rechaza la selección
   * (algún viático no AUTORIZADO, sin cuenta bancaria o con monto <= 0),
   * NO se genera nada — se muestra la lista exacta de problemas para que
   * el facturador corrija la selección. Un fetch exitoso solo lee/valida:
   * no hace ningún POST de entrega ni cambia estado.
   */
  async function generarArchivoBancario() {
    if (!seleccionados.size) {
      setError("Selecciona al menos un viático para generar el archivo bancario.");
      return;
    }
    setGenerandoBanco(true);
    setError("");
    setMensaje("");
    setProblemasBanco([]);
    try {
      const res = await fetch(urlExportar("banco"));
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "No se pudo generar el archivo bancario.");
        setProblemasBanco(data.problemas ?? []);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `viaticos-bibanking-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setMensaje("Archivo bancario generado. El estado de los viáticos sigue AUTORIZADO hasta que registres la entrega.");
    } catch {
      setError("Error de conexión.");
    } finally {
      setGenerandoBanco(false);
    }
  }

  async function registrarPago(row: ViaticoPorPagarRow) {
    const metodo = metodoPago[row.id] ?? "EFECTIVO";
    setPagandoId(row.id);
    setError("");
    setMensaje("");
    try {
      const res = await fetch(`/api/empresas/${slug}/tms/viaticos/${row.id}/entrega`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          metodoPago: metodo,
          referenciaPago: (referenciaPago[row.id] ?? "").trim() || undefined,
          observaciones: (obsEntrega[row.id] ?? "").trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "No se pudo registrar el pago.");
        return;
      }
      setMensaje(`Pago registrado: ${row.personalNombre} (${row.planCodigo}).`);
      await cargar();
    } catch {
      setError("Error de conexión.");
    } finally {
      setPagandoId(null);
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
      <p className="text-xs text-[var(--muted)]">
        Bandeja del facturador — viáticos listos para pagar. Muestra AUTORIZADOS por defecto (cambia
        el filtro Estado para revisar otros). Información interna, incluye dato bancario del empleado
        ya registrado en su ficha RRHH: no se mezcla con Facturación de clientes.
      </p>

      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-[var(--muted)]">
          Viaje
          <input className={`${inputCls} mt-0.5 block w-32`} value={fBusqueda} onChange={(e) => setFBusqueda(e.target.value)} />
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
            <option value="AUTORIZADO">Autorizado (por pagar)</option>
            <option value="ENTREGADO">Entregado</option>
            <option value="LIQUIDADO">Liquidado</option>
            <option value="TODOS">Todos</option>
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

      {/* VIATICOS-BANDEJAS-1 — filtros de método/cuenta, client-side
          (mismo criterio que "Viaje"), se combinan con los demás (Estado,
          fechas, empleado) — sección 5 del ticket: deben cumplir TODO. */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 text-xs text-[var(--muted)]">
          Método:
          {([
            ["", "Todos"],
            ["TRANSFERENCIA", "Transferencia"],
            ["CHEQUE", "Cheque"],
            ["EFECTIVO", "Efectivo"],
          ] as const).map(([valor, etiqueta]) => (
            <button
              key={valor || "todos-metodo"}
              type="button"
              onClick={() => setFMetodo(valor)}
              className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${fMetodo === valor ? "border-sky-500 bg-sky-950/20 text-sky-200" : "border-[var(--border)] hover:bg-[var(--input)]"}`}
            >
              {etiqueta}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 text-xs text-[var(--muted)]">
          Cuenta:
          {([
            ["", "Todos"],
            ["CON", "Con cuenta"],
            ["SIN", "Sin cuenta"],
          ] as const).map(([valor, etiqueta]) => (
            <button
              key={valor || "todos-cuenta"}
              type="button"
              onClick={() => setFCuenta(valor)}
              className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${fCuenta === valor ? "border-sky-500 bg-sky-950/20 text-sky-200" : "border-[var(--border)] hover:bg-[var(--input)]"}`}
            >
              {etiqueta}
            </button>
          ))}
        </div>
      </div>

      {autorizadosVisibles.length ? (
        <p className="text-xs">
          <span className="text-emerald-300">{aptosBanco.length} apto(s) para archivo bancario</span>
          {sinCuentaBanco.length ? (
            <span className="text-amber-300">
              {" "}
              · {sinCuentaBanco.length} sin cuenta bancaria (disponibles para pagar por otro método)
            </span>
          ) : null}
        </p>
      ) : null}

      {/* VIATICOS-BANDEJAS-1 — botón dedicado además del checkbox de
          cabecera de la tabla (mismo toggleSeleccionTodos(), actúa SOLO
          sobre `filtrados`) + totales de la selección visible/válida
          (totalSeleccionado() — nunca cuenta un id fuera de `filtrados`). */}
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <button
          type="button"
          onClick={toggleSeleccionTodos}
          disabled={!filtrados.length}
          className="rounded border border-[var(--border)] px-2.5 py-1 font-medium hover:bg-[var(--input)] disabled:opacity-50"
        >
          {seleccionados.size === filtrados.length && filtrados.length ? "Quitar selección" : "Seleccionar todos visibles"}
        </button>
        <span className="text-[var(--muted)]">
          Seleccionados: <span className="font-medium text-[var(--text)]">{cantidadSeleccionada}</span>
          {" · "}Total: <span className="font-medium text-[var(--text)]">{q(montoSeleccionado)}</span>
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <a
          href={urlExportar("xlsx")}
          className="rounded bg-emerald-700 px-3 py-1.5 text-xs text-white hover:bg-emerald-600"
        >
          Exportar Excel{seleccionados.size ? ` (${seleccionados.size} sel.)` : ""}
        </a>
        <button
          type="button"
          disabled={generandoBanco}
          onClick={() => void generarArchivoBancario()}
          className="rounded bg-[#334155] px-3 py-1.5 text-xs text-white hover:bg-[#3f4b5f] disabled:opacity-50"
        >
          {generandoBanco ? "Generando…" : "Generar archivo bancario"}
          {seleccionados.size ? ` (${seleccionados.size} sel.)` : ""}
        </button>
        <label className="text-[10px] text-[var(--muted)]">
          Tipo (col. 1)
          <input
            className={`${inputCls} ml-1 w-12 py-0.5 text-center`}
            value={tipoOperacion}
            onChange={(e) => setTipoOperacion(e.target.value)}
          />
        </label>
        <span className="text-[10px] text-amber-200/80">
          Archivo Bi Banking (.csv, Windows-1252, sin encabezados) según el layout real de la
          empresa. Solo se genera si todos los seleccionados están AUTORIZADOS, con cuenta
          bancaria y monto válido — descargarlo no cambia ningún estado.
        </span>
      </div>

      {error ? <p className="text-xs text-red-300">{error}</p> : null}
      {problemasBanco.length ? (
        <div className="rounded border border-red-900/40 bg-red-950/10 p-2 text-xs text-red-300">
          <p className="font-medium">No se generó el archivo bancario — corrige estos registros:</p>
          <ul className="mt-1 space-y-0.5">
            {problemasBanco.map((p, i) => (
              <li key={`${p.id}-${i}`}>
                {p.personalNombre || `Viático #${p.id}`}
                {p.planCodigo ? ` (${p.planCodigo})` : ""}: {p.motivo}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {mensaje ? <p className="text-xs text-emerald-300">{mensaje}</p> : null}

      <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-[#1F6AA5] text-white">
            <tr>
              <th className="px-2 py-2">
                <input
                  type="checkbox"
                  checked={filtrados.length > 0 && seleccionados.size === filtrados.length}
                  onChange={toggleSeleccionTodos}
                />
              </th>
              <th className="px-3 py-2">Viaje</th>
              <th className="px-3 py-2">Fecha</th>
              <th className="px-3 py-2">Empleado</th>
              <th className="px-3 py-2">Rol</th>
              <th className="px-3 py-2">Monto</th>
              <th className="px-3 py-2">Forma de pago</th>
              <th className="px-3 py-2">Banco/cuenta</th>
              <th className="px-3 py-2">Estado</th>
              <th className="px-3 py-2">Acción</th>
            </tr>
          </thead>
          <tbody>
            {filtrados.map((r) => (
              <tr key={r.id} className="border-t border-[var(--border)] align-top">
                <td className="px-2 py-2">
                  <input
                    type="checkbox"
                    checked={seleccionados.has(r.id)}
                    onChange={() => toggleSeleccion(r.id)}
                  />
                </td>
                <td className="px-3 py-2">{r.planCodigo}</td>
                <td className="px-3 py-2">{r.fechaPlan}</td>
                <td className="px-3 py-2">
                  {r.personalNombre}
                  {r.personalCodigo ? <span className="text-[var(--muted)]"> ({r.personalCodigo})</span> : null}
                </td>
                <td className="px-3 py-2">{r.rol}</td>
                <td className="px-3 py-2">{q(r.montoAsignado)}</td>
                <td className="px-3 py-2">{r.metodoPago ? METODO_PAGO_LABEL[r.metodoPago] ?? r.metodoPago : "—"}</td>
                <td className="px-3 py-2 text-[11px]">
                  {r.banco || r.cuentaBancaria ? (
                    <>
                      {r.banco || "—"}
                      {r.tipoCuenta ? ` · ${r.tipoCuenta}` : ""}
                      {r.cuentaBancaria ? ` · ${r.cuentaBancaria}` : ""}
                    </>
                  ) : (
                    <span className="text-[var(--muted)]">Sin datos bancarios en ficha</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${ESTADO_BADGE_CLS[r.estado] ?? ""}`}>
                    {r.estado}
                  </span>
                </td>
                <td className="px-3 py-2">
                  {r.estado === "AUTORIZADO" ? (
                    <div className="flex min-w-[220px] flex-wrap items-center gap-1">
                      <select
                        className={`${inputCls} py-1`}
                        value={metodoPago[r.id] ?? "EFECTIVO"}
                        onChange={(e) => setMetodoPago((m) => ({ ...m, [r.id]: e.target.value }))}
                      >
                        <option value="EFECTIVO">Efectivo</option>
                        <option value="TRANSFERENCIA">Transferencia</option>
                        <option value="CHEQUE">Cheque</option>
                      </select>
                      {(metodoPago[r.id] ?? "EFECTIVO") !== "EFECTIVO" ? (
                        <input
                          className={`${inputCls} w-28 py-1`}
                          placeholder={(metodoPago[r.id] ?? "") === "CHEQUE" ? "No. cheque" : "Referencia"}
                          value={referenciaPago[r.id] ?? ""}
                          onChange={(e) => setReferenciaPago((m) => ({ ...m, [r.id]: e.target.value }))}
                        />
                      ) : null}
                      <input
                        className={`${inputCls} w-28 py-1`}
                        placeholder="Obs. (opcional)"
                        value={obsEntrega[r.id] ?? ""}
                        onChange={(e) => setObsEntrega((m) => ({ ...m, [r.id]: e.target.value }))}
                      />
                      <button
                        type="button"
                        disabled={pagandoId === r.id}
                        onClick={() => void registrarPago(r)}
                        className="rounded bg-amber-700 px-2 py-1 text-xs text-white disabled:opacity-50"
                      >
                        {pagandoId === r.id ? "Guardando…" : "Registrar entrega/pago"}
                      </button>
                    </div>
                  ) : (
                    <span className="text-[11px] text-[var(--muted)]">
                      {r.referenciaPago ? `Ref. ${r.referenciaPago}` : "—"}
                    </span>
                  )}
                  {/* VIATICOS-HISTORIAL-FIRMA-1 (sección 12) — visible en
                      cuanto ya exista firma de autorización (todo lo que no
                      es PROGRAMADO); de solo lectura, no otorga permiso de
                      autorizar/liquidar. */}
                  {r.estado !== "PROGRAMADO" ? (
                    <button
                      type="button"
                      onClick={() => setVerFirmasDe(r)}
                      className="mt-1 block rounded border border-[var(--border)] px-2 py-1 text-[11px] hover:bg-[var(--input)]"
                    >
                      Ver firmas
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
            {!filtrados.length && !loading ? (
              <tr>
                <td colSpan={10} className="px-3 py-4 text-[var(--muted)]">
                  Sin viáticos con este filtro.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {verFirmasDe ? (
        <HistorialFirmasModal
          slug={slug}
          viatico={{ id: verFirmasDe.id, planCodigo: verFirmasDe.planCodigo, personalNombre: verFirmasDe.personalNombre }}
          onClose={() => setVerFirmasDe(null)}
        />
      ) : null}
    </div>
  );
}
