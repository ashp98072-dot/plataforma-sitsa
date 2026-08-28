"use client";

import { useCallback, useEffect, useState } from "react";
import { TEXTO_FIRMA_INTERNA } from "@/lib/firmas/textos";

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

/** VIATICOS-FIRMA — confirmación mostrada tras firmar (nunca "Firma Electrónica Avanzada"/certificado/PSC/legal). */
type FirmaInfo = {
  codigoFirma: string;
  nombreFirmante: string;
  rolFirmante: string;
  fechaHoraServidor: string;
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

/**
 * Interpretación UI de los 4 estados REALES (no se inventan estados
 * nuevos — ver src/lib/tms/viaticos.ts, EstadoViatico): PROGRAMADO =
 * pendiente de autorización, AUTORIZADO = pendiente de pago, ENTREGADO =
 * pendiente de liquidación, LIQUIDADO = liquidado.
 */
const ESTADO_LABEL_UI: Record<string, string> = {
  PROGRAMADO: "Pendiente de autorización",
  AUTORIZADO: "Pendiente de pago",
  ENTREGADO: "Pendiente de liquidación",
  LIQUIDADO: "Liquidado",
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
 * Autorizar (individual y masivo, con firma) requiere
 * `viaticos_autorizar:editar`. Liquidar (con firma) requiere
 * `viaticos_liquidar:editar` — VIATICOS-FIRMA: YA NO el genérico
 * `viaticos:editar`. Pagar/entregar vive en su propio panel separado
 * (ViaticosPorPagarPanel) — este NO lo duplica. Banco/cuenta solo se
 * muestran si el backend los incluyó en la respuesta (`puedeVerBancario`)
 * — nunca se piden ni se muestran por el cliente.
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
  const [autorizandoMasivo, setAutorizandoMasivo] = useState(false);

  // VIATICOS-FIRMA — modal "Firmar y autorizar".
  const [autorizando, setAutorizando] = useState<ViaticoControlRow | null>(null);
  const [pwdAutorizar, setPwdAutorizar] = useState("");
  const [errorAutorizar, setErrorAutorizar] = useState("");
  const [firmandoAutorizar, setFirmandoAutorizar] = useState(false);
  const [firmaAutorizarOk, setFirmaAutorizarOk] = useState<FirmaInfo | null>(null);

  // VIATICOS-FIRMA — modal "Firmar liquidación".
  const [liquidando, setLiquidando] = useState<ViaticoControlRow | null>(null);
  const [gastosComprobados, setGastosComprobados] = useState("");
  const [reintegro, setReintegro] = useState("");
  const [obsLiquidacion, setObsLiquidacion] = useState("");
  const [pwdLiquidar, setPwdLiquidar] = useState("");
  const [errorLiquidar, setErrorLiquidar] = useState("");
  const [firmandoLiquidar, setFirmandoLiquidar] = useState(false);
  const [firmaLiquidarOk, setFirmaLiquidarOk] = useState<FirmaInfo | null>(null);

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

  // VIATICOS-FIRMA — "Firmar y autorizar": abre el modal (Viaje/
  // Beneficiario/Monto + contraseña), el POST solo ocurre al confirmar
  // dentro del modal, nunca al primer clic.
  function abrirAutorizar(row: ViaticoControlRow) {
    setAutorizando(row);
    setPwdAutorizar("");
    setErrorAutorizar("");
    setFirmaAutorizarOk(null);
  }

  async function confirmarAutorizar() {
    if (!autorizando) return;
    if (!pwdAutorizar) {
      setErrorAutorizar("Ingresa tu contraseña actual.");
      return;
    }
    setFirmandoAutorizar(true);
    setErrorAutorizar("");
    try {
      const res = await fetch(`/api/empresas/${slug}/tms/viaticos/${autorizando.id}/autorizar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pwdAutorizar }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorAutorizar(data.error ?? "No se pudo autorizar el viático.");
        return;
      }
      setFirmaAutorizarOk(data.firma as FirmaInfo);
      setPwdAutorizar("");
      await cargar();
    } catch {
      setErrorAutorizar("Error de conexión.");
    } finally {
      setFirmandoAutorizar(false);
    }
  }

  // VIATICOS-FIRMA — "Firmar liquidación": monto entregado read-only,
  // gastos/reintegro editables, diferencia calculada en el propio JSX
  // (solo para habilitar/deshabilitar el botón — el backend sigue siendo
  // la autoridad real de la comparación exacta).
  function abrirLiquidar(row: ViaticoControlRow) {
    setLiquidando(row);
    setGastosComprobados("");
    setReintegro("");
    setObsLiquidacion("");
    setPwdLiquidar("");
    setErrorLiquidar("");
    setFirmaLiquidarOk(null);
  }

  async function confirmarLiquidar() {
    if (!liquidando) return;
    if (!pwdLiquidar) {
      setErrorLiquidar("Ingresa tu contraseña actual.");
      return;
    }
    setFirmandoLiquidar(true);
    setErrorLiquidar("");
    try {
      const res = await fetch(`/api/empresas/${slug}/tms/viaticos/${liquidando.id}/liquidar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gastosComprobados: gastosComprobados || "0",
          reintegro: reintegro || "0",
          observaciones: obsLiquidacion.trim() || undefined,
          password: pwdLiquidar,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorLiquidar(data.error ?? "No se pudo liquidar el viático.");
        return;
      }
      setFirmaLiquidarOk(data.firma as FirmaInfo);
      setPwdLiquidar("");
      await cargar();
    } catch {
      setErrorLiquidar("Error de conexión.");
    } finally {
      setFirmandoLiquidar(false);
    }
  }

  /**
   * "AUTORIZAR SELECCIONADOS" — llama el mismo endpoint atómico de a uno
   * por seleccionado (sin nuevo endpoint masivo en backend). Si alguno
   * falla (p. ej. ya no está PROGRAMADO, o la contraseña es incorrecta —
   * en ese caso TODOS fallan de una vez), se reporta con nombre/motivo —
   * nunca se oculta un fallo parcial. VIATICOS-FIRMA: la firma exige
   * contraseña — se pide UNA sola vez para todo el lote (misma
   * reautenticación puntual, aplicada a cada autorización individual).
   */
  async function autorizarSeleccionados() {
    if (!seleccionados.size) {
      setError("Selecciona al menos un viático PROGRAMADO para autorizar.");
      return;
    }
    const password = window.prompt("Ingresa tu contraseña actual para firmar y autorizar los seleccionados:");
    if (!password) return;
    setAutorizandoMasivo(true);
    setError("");
    setMensaje("");
    const ids = [...seleccionados];
    const porId = new Map(items.map((r) => [r.id, r]));
    const fallos: string[] = [];
    let exitos = 0;
    for (const id of ids) {
      try {
        const res = await fetch(`/api/empresas/${slug}/tms/viaticos/${id}/autorizar`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password }),
        });
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
    if (exitos) setMensaje(`${exitos} viático(s) autorizado(s) y firmado(s).`);
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
                    {ESTADO_LABEL_UI[r.estado] ?? r.estado}
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
                      onClick={() => abrirAutorizar(r)}
                      className="rounded bg-sky-700 px-2 py-1 text-xs text-white"
                    >
                      Firmar y autorizar
                    </button>
                  ) : null}
                  {puedeLiquidar && r.estado === "ENTREGADO" ? (
                    <button
                      type="button"
                      onClick={() => abrirLiquidar(r)}
                      className="rounded bg-emerald-700 px-2 py-1 text-xs text-white"
                    >
                      Firmar liquidación
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

      {/* VIATICOS-FIRMA — modal "Firma de autorización". Firma electrónica
          INTERNA y SIMBÓLICA: nunca "Firma Electrónica Avanzada"/
          certificado/PSC/legal. */}
      {autorizando ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md space-y-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-xl">
            {firmaAutorizarOk ? (
              <>
                <h3 className="text-sm font-semibold">Viático autorizado</h3>
                <div className="rounded-lg border border-emerald-700/40 bg-emerald-950/20 p-3 text-xs">
                  <p className="font-medium">Firmado electrónicamente por:</p>
                  <p className="mt-1 text-sm font-semibold">{firmaAutorizarOk.nombreFirmante}</p>
                  <p className="mt-1"><span className="text-[var(--muted)]">Rol:</span> {firmaAutorizarOk.rolFirmante}</p>
                  <p><span className="text-[var(--muted)]">Fecha:</span> {new Date(firmaAutorizarOk.fechaHoraServidor).toLocaleString("es-GT")}</p>
                  <p><span className="text-[var(--muted)]">Código de firma:</span> {firmaAutorizarOk.codigoFirma}</p>
                </div>
                <button
                  type="button"
                  className="w-full rounded bg-[var(--accent)] px-3 py-1.5 text-sm text-white"
                  onClick={() => setAutorizando(null)}
                >
                  Cerrar
                </button>
              </>
            ) : (
              <>
                <h3 className="text-sm font-semibold">Firma de autorización</h3>
                <div className="space-y-1 text-xs">
                  <p><span className="text-[var(--muted)]">Viaje:</span> {autorizando.planCodigo}{autorizando.cliente ? ` · ${autorizando.cliente}` : ""}</p>
                  <p><span className="text-[var(--muted)]">Beneficiario:</span> {autorizando.personalNombre} ({autorizando.rol})</p>
                  <p><span className="text-[var(--muted)]">Monto:</span> {q(autorizando.montoAsignado)}</p>
                </div>
                <p className="text-xs text-[var(--muted)]">Al firmar confirmas que autorizas este viático.</p>
                <p className="text-[10px] text-[var(--muted)]">{TEXTO_FIRMA_INTERNA} — no es una firma legal certificada.</p>
                <label className="block text-xs text-[var(--muted)]">
                  Contraseña
                  <input
                    type="password"
                    className={`${inputCls} mt-0.5 block w-full`}
                    value={pwdAutorizar}
                    onChange={(e) => setPwdAutorizar(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") void confirmarAutorizar(); }}
                  />
                </label>
                {errorAutorizar ? <p className="text-xs text-red-300">{errorAutorizar}</p> : null}
                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    disabled={firmandoAutorizar}
                    className="flex-1 rounded bg-sky-700 px-3 py-1.5 text-sm text-white disabled:opacity-50"
                    onClick={() => void confirmarAutorizar()}
                  >
                    {firmandoAutorizar ? "Firmando…" : "Firmar y autorizar"}
                  </button>
                  <button
                    type="button"
                    disabled={firmandoAutorizar}
                    className="rounded border border-[var(--border)] px-3 py-1.5 text-sm"
                    onClick={() => setAutorizando(null)}
                  >
                    Cancelar
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}

      {/* VIATICOS-FIRMA — modal "Firma de liquidación". Diferencia calculada
          en vivo SOLO para habilitar/deshabilitar el botón — el backend
          sigue siendo la autoridad real de la comparación exacta (centavos,
          nunca float). */}
      {liquidando ? (
        (() => {
          const centavosUi = (v: string) => {
            const n = Number(v || "0");
            return Number.isFinite(n) ? Math.round(n * 100) : NaN;
          };
          const montoCent = Math.round(liquidando.montoAsignado * 100);
          const gastosCent = centavosUi(gastosComprobados);
          const reintegroCent = centavosUi(reintegro);
          const valoresValidos = Number.isFinite(gastosCent) && Number.isFinite(reintegroCent) && gastosCent >= 0 && reintegroCent >= 0;
          const diferenciaCent = valoresValidos ? montoCent - gastosCent - reintegroCent : NaN;
          const puedeFirmar = valoresValidos && diferenciaCent === 0;
          return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
              <div className="w-full max-w-md space-y-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-xl">
                {firmaLiquidarOk ? (
                  <>
                    <h3 className="text-sm font-semibold">Viático liquidado</h3>
                    <div className="rounded-lg border border-emerald-700/40 bg-emerald-950/20 p-3 text-xs">
                      <p className="font-medium">Firmado electrónicamente por:</p>
                      <p className="mt-1 text-sm font-semibold">{firmaLiquidarOk.nombreFirmante}</p>
                      <p className="mt-1"><span className="text-[var(--muted)]">Rol:</span> {firmaLiquidarOk.rolFirmante}</p>
                      <p><span className="text-[var(--muted)]">Fecha:</span> {new Date(firmaLiquidarOk.fechaHoraServidor).toLocaleString("es-GT")}</p>
                      <p><span className="text-[var(--muted)]">Código de firma:</span> {firmaLiquidarOk.codigoFirma}</p>
                    </div>
                    <button
                      type="button"
                      className="w-full rounded bg-[var(--accent)] px-3 py-1.5 text-sm text-white"
                      onClick={() => setLiquidando(null)}
                    >
                      Cerrar
                    </button>
                  </>
                ) : (
                  <>
                    <h3 className="text-sm font-semibold">Firma de liquidación</h3>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <label className="text-[var(--muted)]">
                        Monto entregado
                        <input className={`${inputCls} mt-0.5 block w-full bg-[var(--panel)]`} value={q(liquidando.montoAsignado)} disabled readOnly />
                      </label>
                      <label className="text-[var(--muted)]">
                        Gastos comprobados
                        <input inputMode="decimal" className={`${inputCls} mt-0.5 block w-full`} value={gastosComprobados} onChange={(e) => setGastosComprobados(e.target.value)} placeholder="0.00" />
                      </label>
                      <label className="text-[var(--muted)]">
                        Reintegro
                        <input inputMode="decimal" className={`${inputCls} mt-0.5 block w-full`} value={reintegro} onChange={(e) => setReintegro(e.target.value)} placeholder="0.00" />
                      </label>
                      <label className="text-[var(--muted)]">
                        Diferencia
                        <input className={`${inputCls} mt-0.5 block w-full bg-[var(--panel)]`} value={valoresValidos ? q(diferenciaCent / 100) : "—"} disabled readOnly />
                      </label>
                    </div>
                    {valoresValidos && diferenciaCent > 0 ? (
                      <p className="text-xs text-amber-300">Pendiente por comprobar o reintegrar: {q(diferenciaCent / 100)}</p>
                    ) : null}
                    {valoresValidos && diferenciaCent < 0 ? (
                      <p className="text-xs text-red-300">Los gastos y reintegros superan el monto entregado. Revisa la liquidación.</p>
                    ) : null}
                    <label className="block text-xs text-[var(--muted)]">
                      Observaciones (opcional)
                      <input className={`${inputCls} mt-0.5 block w-full`} value={obsLiquidacion} onChange={(e) => setObsLiquidacion(e.target.value)} maxLength={300} />
                    </label>
                    <p className="text-xs text-[var(--muted)]">Al firmar confirmas que revisaste esta liquidación.</p>
                    <p className="text-[10px] text-[var(--muted)]">{TEXTO_FIRMA_INTERNA} — no es una firma legal certificada.</p>
                    <label className="block text-xs text-[var(--muted)]">
                      Contraseña
                      <input
                        type="password"
                        className={`${inputCls} mt-0.5 block w-full`}
                        value={pwdLiquidar}
                        onChange={(e) => setPwdLiquidar(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter" && puedeFirmar) void confirmarLiquidar(); }}
                      />
                    </label>
                    {errorLiquidar ? <p className="text-xs text-red-300">{errorLiquidar}</p> : null}
                    <div className="flex gap-2 pt-1">
                      <button
                        type="button"
                        disabled={firmandoLiquidar || !puedeFirmar}
                        title={!puedeFirmar ? "La diferencia debe ser exactamente Q0.00 para poder firmar la liquidación." : undefined}
                        className="flex-1 rounded bg-emerald-700 px-3 py-1.5 text-sm text-white disabled:opacity-50"
                        onClick={() => void confirmarLiquidar()}
                      >
                        {firmandoLiquidar ? "Firmando…" : "Firmar liquidación"}
                      </button>
                      <button
                        type="button"
                        disabled={firmandoLiquidar}
                        className="rounded border border-[var(--border)] px-3 py-1.5 text-sm"
                        onClick={() => setLiquidando(null)}
                      >
                        Cancelar
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          );
        })()
      ) : null}
    </div>
  );
}
