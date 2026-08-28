"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { FacturaBorradorForm, type LineaBorrador } from "@/components/facturacion/factura-borrador-form";
import {
  badgeAdminClase,
  badgeFinancieroClase,
  calcularTotalPaginas,
  esBorrador,
  esEmitida,
  interpretarError,
  puedeOfrecerAnular,
  validarEmision,
  type EstadoAdmin,
  type EstadoFinanciero,
} from "@/lib/facturacion/ui-logica";

/**
 * FACT-1-UI (Fase F/G/H/I/J/K) — Operaciones → Facturación clientes →
 * Facturas. Consume GET/PATCH /facturacion/facturas(/[id]) y los 3
 * endpoints de acción (emitir/anular/pagos) — NUNCA un PATCH directo de
 * estado_admin (eso solo lo hacen emitir/anular en el backend).
 */

type Factura = {
  id: number;
  clienteId: number;
  cliente: string;
  numeroFactura: string | null;
  fechaEmision: string | null;
  montoTotal: number;
  estadoAdmin: EstadoAdmin;
  observaciones: string | null;
  totalPagado: number;
  saldo: number;
  estadoFinanciero: EstadoFinanciero | null;
};

type FacturaViajeLinea = { id: number; planId: number; codigo: string; fechaPlan: string; montoAsignado: number };
type PagoFactura = { id: number; fechaPago: string; monto: number; referencia: string | null; medioPago: string | null; observaciones: string | null; registradoPor: number; creadoEn: string };
type ClienteCat = { clienteId: number; nombre: string };

type Props = {
  slug: string;
  puedeCrear: boolean;
  puedeEditar: boolean;
  abrirFacturaId: number | null;
  onAbierta: () => void;
  onCambio: () => void;
};

function moneda(v: number | null): string {
  if (v == null) return "—";
  return `Q${v.toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const inputCls = "rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1.5 text-sm text-[var(--text)]";
const linkCls = "text-[var(--accent)] hover:underline";
const PAGE_SIZE = 50;

export function FacturasPanel({ slug, puedeCrear, puedeEditar, abrirFacturaId, onAbierta, onCambio }: Props) {
  const [clientesCat, setClientesCat] = useState<ClienteCat[]>([]);
  useEffect(() => {
    fetch(`/api/empresas/${slug}/facturacion/clientes`)
      .then((r) => r.json())
      .then((data) => setClientesCat((data.clientes ?? []) as ClienteCat[]))
      .catch(() => undefined);
  }, [slug]);

  const [fCliente, setFCliente] = useState("");
  const [fEstado, setFEstado] = useState("");
  const [fDesde, setFDesde] = useState("");
  const [fHasta, setFHasta] = useState("");

  const [facturas, setFacturas] = useState<Factura[]>([]);
  const [page, setPage] = useState(1);
  const [totalReal, setTotalReal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const filtrosQueryString = useCallback(() => {
    const p = new URLSearchParams();
    if (fCliente) p.set("clienteId", fCliente);
    if (fEstado) p.set("estadoAdmin", fEstado);
    if (fDesde) p.set("fechaDesde", fDesde);
    if (fHasta) p.set("fechaHasta", fHasta);
    return p;
  }, [fCliente, fEstado, fDesde, fHasta]);

  const cargar = useCallback(async (paginaSolicitada = 1) => {
    setLoading(true);
    setError("");
    try {
      const p = filtrosQueryString();
      p.set("page", String(paginaSolicitada));
      p.set("pageSize", String(PAGE_SIZE));
      const res = await fetch(`/api/empresas/${slug}/facturacion/facturas?${p.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error ?? "No se pudo cargar las facturas."); return; }
      setFacturas((data.facturas ?? []) as Factura[]);
      setTotalReal(Number(data.totalReal ?? 0));
      setPage(paginaSolicitada);
    } catch {
      setError("Error de conexión.");
    } finally {
      setLoading(false);
    }
  }, [slug, filtrosQueryString]);

  const [buscarTick, setBuscarTick] = useState(0);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void cargar(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buscarTick]);

  function buscar() { setBuscarTick((t) => t + 1); }
  function limpiarFiltros() {
    setFCliente(""); setFEstado(""); setFDesde(""); setFHasta("");
    setBuscarTick((t) => t + 1);
  }

  // --- Detalle expandible (Fase G) ---
  const [expandido, setExpandido] = useState<number | null>(null);
  const [detalle, setDetalle] = useState<{ factura: Factura; viajes: FacturaViajeLinea[]; pagos: PagoFactura[] } | null>(null);
  const [cargandoDetalle, setCargandoDetalle] = useState(false);
  const [editandoBorrador, setEditandoBorrador] = useState(false);
  const [confirmandoEmitir, setConfirmandoEmitir] = useState(false);
  const [emitNumero, setEmitNumero] = useState("");
  const [emitFecha, setEmitFecha] = useState("");
  const [emitiendo, setEmitiendo] = useState(false);
  const [errorEmitir, setErrorEmitir] = useState("");
  const [confirmandoAnular, setConfirmandoAnular] = useState(false);
  const [anulando, setAnulando] = useState(false);
  const [errorAnular, setErrorAnular] = useState("");
  const [mostrarPago, setMostrarPago] = useState(false);
  const [pagoFecha, setPagoFecha] = useState("");
  const [pagoMonto, setPagoMonto] = useState("");
  const [pagoMedio, setPagoMedio] = useState("");
  const [pagoReferencia, setPagoReferencia] = useState("");
  const [pagoObs, setPagoObs] = useState("");
  const [registrandoPago, setRegistrandoPago] = useState(false);
  const [errorPago, setErrorPago] = useState("");

  const abrirDetalle = useCallback(async (facturaId: number) => {
    if (expandido === facturaId) { setExpandido(null); return; }
    setExpandido(facturaId);
    setEditandoBorrador(false);
    setConfirmandoEmitir(false);
    setConfirmandoAnular(false);
    setMostrarPago(false);
    setErrorEmitir(""); setErrorAnular(""); setErrorPago("");
    setCargandoDetalle(true);
    try {
      const res = await fetch(`/api/empresas/${slug}/facturacion/facturas/${facturaId}`);
      const data = await res.json().catch(() => ({}));
      if (res.ok) setDetalle(data);
    } finally {
      setCargandoDetalle(false);
    }
  }, [slug, expandido]);

  // Cruce desde Viajes pendientes: al crear una factura, el padre pide
  // abrirla aquí directamente.
  useEffect(() => {
    if (abrirFacturaId == null) return;
    void (async () => {
      await cargar(1);
      await abrirDetalle(abrirFacturaId);
      onAbierta();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abrirFacturaId]);

  async function refrescarDetalle(facturaId: number) {
    const res = await fetch(`/api/empresas/${slug}/facturacion/facturas/${facturaId}`);
    const data = await res.json().catch(() => ({}));
    if (res.ok) setDetalle(data);
    await cargar(page);
    onCambio();
  }

  async function emitir(facturaId: number) {
    // Fase I — validación de UI antes del POST (el backend sigue siendo
    // la autoridad final: valida de nuevo con el dato ya guardado si el
    // campo se deja vacío aquí).
    const numeroParaValidar = emitNumero.trim() || detalle?.factura.numeroFactura || "";
    const fechaParaValidar = emitFecha || detalle?.factura.fechaEmision || "";
    const errorValidacion = validarEmision(numeroParaValidar, fechaParaValidar);
    if (errorValidacion) { setErrorEmitir(errorValidacion); return; }
    setEmitiendo(true);
    setErrorEmitir("");
    try {
      const res = await fetch(`/api/empresas/${slug}/facturacion/facturas/${facturaId}/emitir`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ numeroFactura: emitNumero.trim() || undefined, fechaEmision: emitFecha || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setErrorEmitir(interpretarError(data, "No se pudo emitir la factura.")); return; }
      setConfirmandoEmitir(false);
      await refrescarDetalle(facturaId);
    } finally {
      setEmitiendo(false);
    }
  }

  async function anular(facturaId: number) {
    setAnulando(true);
    setErrorAnular("");
    try {
      const res = await fetch(`/api/empresas/${slug}/facturacion/facturas/${facturaId}/anular`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setErrorAnular(interpretarError(data, "No se pudo anular la factura.")); return; }
      setConfirmandoAnular(false);
      await refrescarDetalle(facturaId);
    } finally {
      setAnulando(false);
    }
  }

  async function registrarPago(facturaId: number) {
    const monto = Number(pagoMonto);
    if (!pagoFecha || !Number.isFinite(monto) || monto <= 0) { setErrorPago("Fecha y monto (mayor que cero) son obligatorios."); return; }
    setRegistrandoPago(true);
    setErrorPago("");
    try {
      const res = await fetch(`/api/empresas/${slug}/facturacion/facturas/${facturaId}/pagos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fechaPago: pagoFecha, monto,
          medioPago: pagoMedio.trim() || undefined,
          referencia: pagoReferencia.trim() || undefined,
          observaciones: pagoObs.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setErrorPago(interpretarError(data, "No se pudo registrar el pago.")); return; }
      setMostrarPago(false);
      setPagoFecha(""); setPagoMonto(""); setPagoMedio(""); setPagoReferencia(""); setPagoObs("");
      await refrescarDetalle(facturaId);
    } finally {
      setRegistrandoPago(false);
    }
  }

  const totalPaginas = calcularTotalPaginas(totalReal, PAGE_SIZE);

  return (
    <div className="space-y-3">
      <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3">
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
            Cliente
            <select className={inputCls} value={fCliente} onChange={(e) => setFCliente(e.target.value)}>
              <option value="">Todos</option>
              {clientesCat.map((c) => <option key={c.clienteId} value={c.clienteId}>{c.nombre}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
            Estado
            <select className={inputCls} value={fEstado} onChange={(e) => setFEstado(e.target.value)}>
              <option value="">Todos</option>
              <option value="Borrador">Borrador</option>
              <option value="Emitida">Emitida</option>
              <option value="Anulada">Anulada</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
            Fecha desde
            <input className={inputCls} type="date" value={fDesde} onChange={(e) => setFDesde(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
            Fecha hasta
            <input className={inputCls} type="date" value={fHasta} onChange={(e) => setFHasta(e.target.value)} />
          </label>
          <button type="button" className="rounded bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white" onClick={buscar}>Buscar</button>
          <button type="button" className="rounded border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text)]" onClick={limpiarFiltros}>Limpiar filtros</button>
        </div>
      </section>

      {error ? <p className="text-sm text-rose-500">{error}</p> : null}

      <div className="table-scroll rounded-xl border border-[var(--border)]">
        <table className="min-w-[900px] w-full text-left text-sm">
          <thead className="bg-[var(--thead)] text-xs uppercase text-[var(--muted)]">
            <tr>
              <th className="px-2 py-2">Número</th>
              <th className="px-2 py-2">Cliente</th>
              <th className="px-2 py-2">Fecha emisión</th>
              <th className="px-2 py-2">Monto total</th>
              <th className="px-2 py-2">Total pagado</th>
              <th className="px-2 py-2">Saldo</th>
              <th className="px-2 py-2">Estado</th>
              <th className="px-2 py-2">Cobro</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {facturas.map((f) => (
              <Fragment key={f.id}>
                <tr className="border-t border-[var(--border)] align-top">
                  <td className="px-2 py-1.5 font-mono text-xs">{f.numeroFactura ?? "—"}</td>
                  <td className="px-2 py-1.5 text-xs">{f.cliente}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-xs">{f.fechaEmision ?? "—"}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-xs">{moneda(f.montoTotal)}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-xs">{moneda(f.totalPagado)}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-xs">{moneda(f.saldo)}</td>
                  <td className="px-2 py-1.5"><span className={`rounded-full px-2 py-0.5 text-[10px] font-medium text-white ${badgeAdminClase(f.estadoAdmin)}`}>{f.estadoAdmin}</span></td>
                  <td className="px-2 py-1.5"><span className={`rounded-full px-2 py-0.5 text-[10px] font-medium text-white ${badgeFinancieroClase(f.estadoFinanciero)}`}>{f.estadoFinanciero ?? "—"}</span></td>
                  <td className="px-2 py-1.5"><button type="button" className={linkCls} onClick={() => void abrirDetalle(f.id)}>{expandido === f.id ? "Cerrar" : "Ver detalle"}</button></td>
                </tr>
                {expandido === f.id ? (
                  <tr className="border-t border-[var(--border)] bg-[var(--panel)]">
                    <td colSpan={9} className="px-3 py-3">
                      {cargandoDetalle || !detalle ? (
                        <p className="text-xs text-[var(--muted)]">Cargando…</p>
                      ) : editandoBorrador ? (
                        <FacturaBorradorForm
                          slug={slug}
                          clienteId={detalle.factura.clienteId}
                          clienteNombre={detalle.factura.cliente}
                          facturaId={detalle.factura.id}
                          lineasIniciales={detalle.viajes.map((v): LineaBorrador => ({ planId: v.planId, codigo: v.codigo, fechaPlan: v.fechaPlan, placa: null, tarifaComercial: null, montoAsignado: v.montoAsignado }))}
                          numeroFacturaInicial={detalle.factura.numeroFactura}
                          fechaEmisionInicial={detalle.factura.fechaEmision}
                          observacionesInicial={detalle.factura.observaciones}
                          onGuardado={async () => { setEditandoBorrador(false); await refrescarDetalle(f.id); }}
                          onCancelar={() => setEditandoBorrador(false)}
                        />
                      ) : (
                        <div className="space-y-3">
                          <div className="grid gap-4 lg:grid-cols-3">
                            <div>
                              <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">A. Datos</p>
                              <ul className="mt-1 space-y-0.5 text-xs text-[var(--text)]">
                                <li>Número: {detalle.factura.numeroFactura ?? "—"}</li>
                                <li>Cliente: {detalle.factura.cliente}</li>
                                <li>Fecha emisión: {detalle.factura.fechaEmision ?? "—"}</li>
                                <li>Estado: {detalle.factura.estadoAdmin}</li>
                                <li>Monto total: {moneda(detalle.factura.montoTotal)}</li>
                                <li>Total pagado: {moneda(detalle.factura.totalPagado)}</li>
                                <li>Saldo: {moneda(detalle.factura.saldo)}</li>
                                <li>Estado financiero: {detalle.factura.estadoFinanciero ?? "—"}</li>
                                <li>Observaciones: {detalle.factura.observaciones ?? "—"}</li>
                              </ul>
                              {puedeEditar && esBorrador(detalle.factura.estadoAdmin) ? (
                                <button type="button" className="mt-2 rounded border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--text)]" onClick={() => setEditandoBorrador(true)}>
                                  Editar borrador
                                </button>
                              ) : null}
                            </div>
                            <div>
                              <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">B. Viajes</p>
                              <ul className="mt-1 space-y-0.5 text-xs text-[var(--text)]">
                                {detalle.viajes.map((v) => (
                                  <li key={v.id}>{v.codigo} · {v.fechaPlan} · {moneda(v.montoAsignado)}</li>
                                ))}
                                {!detalle.viajes.length ? <li className="text-[var(--muted)]">Sin viajes.</li> : null}
                              </ul>
                            </div>
                            <div>
                              <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">C. Pagos</p>
                              <ul className="mt-1 space-y-0.5 text-xs text-[var(--text)]">
                                {detalle.pagos.map((pg) => (
                                  <li key={pg.id}>{pg.fechaPago} · {moneda(pg.monto)} {pg.medioPago ? `· ${pg.medioPago}` : ""} {pg.referencia ? `· ref. ${pg.referencia}` : ""}</li>
                                ))}
                                {!detalle.pagos.length ? <li className="text-[var(--muted)]">Sin pagos registrados.</li> : null}
                              </ul>
                            </div>
                          </div>

                          {/* Fase I: emitir — solo Borrador */}
                          {puedeEditar && esBorrador(detalle.factura.estadoAdmin) ? (
                            confirmandoEmitir ? (
                              <div className="space-y-1.5 rounded border border-sky-700/60 bg-sky-950/10 p-2 text-xs">
                                <p className="font-semibold text-sky-700">Confirmar emisión</p>
                                <ul className="grid gap-x-4 gap-y-0.5 sm:grid-cols-2">
                                  <li>Cliente: {detalle.factura.cliente}</li>
                                  <li>Viajes: {detalle.viajes.length}</li>
                                  <li>Total: {moneda(detalle.factura.montoTotal)}</li>
                                </ul>
                                <div className="grid gap-2 sm:grid-cols-2">
                                  <label className="flex flex-col gap-1">
                                    Número de factura
                                    <input className={inputCls} value={emitNumero} onChange={(e) => setEmitNumero(e.target.value)} placeholder={detalle.factura.numeroFactura ?? "Requerido"} />
                                  </label>
                                  <label className="flex flex-col gap-1">
                                    Fecha de emisión
                                    <input className={inputCls} type="date" value={emitFecha} onChange={(e) => setEmitFecha(e.target.value)} placeholder={detalle.factura.fechaEmision ?? "Requerida"} />
                                  </label>
                                </div>
                                {errorEmitir ? <p className="text-rose-500">{errorEmitir}</p> : null}
                                <div className="flex gap-2 pt-1">
                                  <button type="button" disabled={emitiendo} className="rounded bg-sky-600 px-2.5 py-1 font-medium text-white disabled:opacity-50" onClick={() => void emitir(f.id)}>
                                    {emitiendo ? "Emitiendo…" : "Confirmar emisión"}
                                  </button>
                                  <button type="button" disabled={emitiendo} className="rounded border border-[var(--border)] px-2.5 py-1 text-[var(--text)]" onClick={() => { setConfirmandoEmitir(false); setErrorEmitir(""); }}>Cancelar</button>
                                </div>
                              </div>
                            ) : (
                              <button type="button" className="rounded bg-sky-600 px-2.5 py-1 text-xs font-medium text-white" onClick={() => { setConfirmandoEmitir(true); setEmitNumero(detalle.factura.numeroFactura ?? ""); setEmitFecha(detalle.factura.fechaEmision ?? ""); }}>
                                Emitir factura
                              </button>
                            )
                          ) : null}

                          {/* Fase J: pagos — solo Emitida */}
                          {puedeCrear && esEmitida(detalle.factura.estadoAdmin) ? (
                            <div>
                              <p className="mb-1 text-xs text-[var(--muted)]">Saldo actual: <span className="font-medium text-[var(--text)]">{moneda(detalle.factura.saldo)}</span></p>
                              {mostrarPago ? (
                                <div className="space-y-1.5 rounded border border-[var(--border)] p-2 text-xs">
                                  <div className="grid gap-2 sm:grid-cols-2">
                                    <label className="flex flex-col gap-1">Fecha de pago<input className={inputCls} type="date" value={pagoFecha} onChange={(e) => setPagoFecha(e.target.value)} /></label>
                                    <label className="flex flex-col gap-1">Monto<input className={inputCls} type="number" step="0.01" min={0} max={detalle.factura.saldo} value={pagoMonto} onChange={(e) => setPagoMonto(e.target.value)} /></label>
                                    <label className="flex flex-col gap-1">Medio de pago<input className={inputCls} value={pagoMedio} onChange={(e) => setPagoMedio(e.target.value)} /></label>
                                    <label className="flex flex-col gap-1">Referencia<input className={inputCls} value={pagoReferencia} onChange={(e) => setPagoReferencia(e.target.value)} /></label>
                                    <label className="flex flex-col gap-1 sm:col-span-2">Observaciones<input className={inputCls} value={pagoObs} onChange={(e) => setPagoObs(e.target.value)} /></label>
                                  </div>
                                  {errorPago ? <p className="text-rose-500">{errorPago}</p> : null}
                                  <div className="flex gap-2 pt-1">
                                    <button type="button" disabled={registrandoPago} className="rounded bg-emerald-600 px-2.5 py-1 font-medium text-white disabled:opacity-50" onClick={() => void registrarPago(f.id)}>
                                      {registrandoPago ? "Registrando…" : "Guardar pago"}
                                    </button>
                                    <button type="button" disabled={registrandoPago} className="rounded border border-[var(--border)] px-2.5 py-1 text-[var(--text)]" onClick={() => { setMostrarPago(false); setErrorPago(""); }}>Cancelar</button>
                                  </div>
                                </div>
                              ) : (
                                <button type="button" className="rounded bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white" onClick={() => setMostrarPago(true)}>Registrar pago</button>
                              )}
                            </div>
                          ) : null}

                          {/* Fase K: anular — Borrador o Emitida, nunca ya Anulada */}
                          {puedeEditar && puedeOfrecerAnular(detalle.factura.estadoAdmin) ? (
                            confirmandoAnular ? (
                              <div className="space-y-1.5 rounded border border-rose-700/60 bg-rose-950/10 p-2 text-xs">
                                <p className="font-semibold text-rose-600">Confirmar anulación</p>
                                <p>Si la factura no tiene pagos, los viajes quedarán libres para volver a facturarse.</p>
                                {errorAnular ? <p className="text-rose-500">{errorAnular}</p> : null}
                                <div className="flex gap-2 pt-1">
                                  <button type="button" disabled={anulando} className="rounded bg-rose-600 px-2.5 py-1 font-medium text-white disabled:opacity-50" onClick={() => void anular(f.id)}>
                                    {anulando ? "Anulando…" : "Confirmar anulación"}
                                  </button>
                                  <button type="button" disabled={anulando} className="rounded border border-[var(--border)] px-2.5 py-1 text-[var(--text)]" onClick={() => { setConfirmandoAnular(false); setErrorAnular(""); }}>Cancelar</button>
                                </div>
                              </div>
                            ) : (
                              <button type="button" className="text-xs text-rose-500 hover:underline" onClick={() => setConfirmandoAnular(true)}>Anular factura</button>
                            )
                          ) : null}
                        </div>
                      )}
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            ))}
            {!facturas.length && !loading ? (
              <tr><td colSpan={9} className="px-3 py-4 text-center text-sm text-[var(--muted)]">Sin facturas con estos filtros.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--muted)]">
        <span>{totalReal ? `${totalReal} factura(s)` : loading ? "Cargando…" : "Sin facturas con estos filtros."}</span>
        <div className="flex gap-2">
          <button type="button" className="rounded border border-[var(--border)] px-2.5 py-1 text-[var(--text)] disabled:opacity-40" disabled={loading || page <= 1} onClick={() => void cargar(page - 1)}>← Anterior</button>
          <span className="px-1 py-1">Página {page} de {totalPaginas}</span>
          <button type="button" className="rounded border border-[var(--border)] px-2.5 py-1 text-[var(--text)] disabled:opacity-40" disabled={loading || page >= totalPaginas} onClick={() => void cargar(page + 1)}>Siguiente →</button>
        </div>
      </div>
    </div>
  );
}
