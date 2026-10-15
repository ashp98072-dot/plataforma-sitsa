"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ALCANCES_HISTORIAL,
  ESTADOS_FINANCIEROS_DERIVADOS,
  ETIQUETA_ESTADO_DERIVADO,
  ROTULO_SALDO_INFORMATIVO,
  TEXTO_SIN_ENTIDAD,
  TEXTO_VENCIMIENTO_NO_DISPONIBLE,
  type AlcanceHistorial,
  type FilaClienteCxc,
  type FilaCxc,
  type RespuestaListaCxc,
  type ResumenClienteCxc,
} from "@/lib/facturacion/cuentas-por-cobrar-shared";
import type { ConfirmacionClienteFila, PagoClienteFila } from "@/lib/facturacion/cuentas-por-cobrar";

/**
 * M-2a — «Cuentas por cobrar» informativa dentro de Facturación. SOLO LECTURA: ningún botón escribe. Tres secciones:
 * Cartera abierta · Historial · Por cliente. El rótulo del saldo informativo es permanente.
 */

type SubVista = "cartera" | "historial" | "cliente";
type Entidad = { id: number; codigo: string; nombre: string };
type ListaConEntidades = RespuestaListaCxc & { entidades: Entidad[] };

const PAGE_SIZE = 25;
const inputCls = "rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-xs text-[var(--text)]";

function q(n: string | number | null | undefined): string {
  if (n == null || n === "") return "—";
  const v = Number(n);
  return Number.isFinite(v) ? `Q${v.toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—";
}

const ESTADO_CLASE: Record<string, string> = {
  SIN_PAGOS: "bg-slate-600",
  PARCIAL: "bg-amber-700",
  PAGADA: "bg-emerald-700",
  ANULADA: "bg-zinc-600",
};

export function CuentasPorCobrarPanel({ slug }: { slug: string }) {
  const [vista, setVista] = useState<SubVista>("cartera");
  const [entidades, setEntidades] = useState<Entidad[]>([]);

  // Filtros (borrador) y aplicados.
  const vacio = { clienteId: "", entidad: "", estado: "", estadoAdmin: "", desde: "", hasta: "", numero: "", texto: "", alcance: "todas" as AlcanceHistorial };
  const [borrador, setBorrador] = useState(vacio);
  const [aplicados, setAplicados] = useState(vacio);
  const [page, setPage] = useState(1);

  const [lista, setLista] = useState<ListaConEntidades | null>(null);
  const [clientes, setClientes] = useState<{ filas: FilaClienteCxc[]; totalReal: number } | null>(null);
  const [detalle, setDetalle] = useState<{ resumen: ResumenClienteCxc; pagos: { filas: PagoClienteFila[]; totalReal: number }; confirmaciones: { filas: ConfirmacionClienteFila[]; totalReal: number } } | null>(null);
  const [facturasCliente, setFacturasCliente] = useState<FilaCxc[]>([]);
  const [clienteSel, setClienteSel] = useState<{ id: number; entidad: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const base = `/api/empresas/${slug}/facturacion/cuentas-por-cobrar`;

  const paramsLista = useCallback(
    (v: "cartera" | "historial", p: number) => {
      const sp = new URLSearchParams({ vista: v, page: String(p), pageSize: String(PAGE_SIZE) });
      const a = aplicados;
      if (a.clienteId) sp.set("clienteId", a.clienteId);
      if (a.entidad) sp.set("entidad", a.entidad);
      if (a.estado) sp.set("estado", a.estado);
      if (a.estadoAdmin && v === "historial") sp.set("estadoAdmin", a.estadoAdmin);
      if (a.desde) sp.set("fechaDesde", a.desde);
      if (a.hasta) sp.set("fechaHasta", a.hasta);
      if (a.numero.trim()) sp.set("numeroFactura", a.numero.trim());
      if (a.texto.trim()) sp.set("textoCliente", a.texto.trim());
      if (v === "historial" && a.alcance !== "todas") sp.set("alcance", a.alcance);
      return sp;
    },
    [aplicados],
  );

  const cargar = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      if (vista === "cartera" || vista === "historial") {
        const res = await fetch(`${base}?${paramsLista(vista, page)}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error((data as { error?: string }).error ?? "No se pudo cargar.");
        setLista(data as ListaConEntidades);
        setEntidades((data as ListaConEntidades).entidades ?? []);
      } else if (clienteSel) {
        const sp = new URLSearchParams();
        if (clienteSel.entidad) sp.set("entidad", clienteSel.entidad);
        const [res, resF] = await Promise.all([
          fetch(`${base}/clientes/${clienteSel.id}?${sp}`),
          fetch(`${base}?${new URLSearchParams({ vista: "historial", clienteId: String(clienteSel.id), pageSize: "100", ...(clienteSel.entidad ? { entidad: clienteSel.entidad } : {}) })}`),
        ]);
        const d = await res.json().catch(() => ({}));
        const f = await resF.json().catch(() => ({}));
        if (!res.ok) throw new Error((d as { error?: string }).error ?? "No se pudo cargar el cliente.");
        setDetalle(d);
        setFacturasCliente((f as RespuestaListaCxc).filas ?? []);
      } else {
        const sp = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
        if (aplicados.entidad) sp.set("entidad", aplicados.entidad);
        if (aplicados.texto.trim()) sp.set("textoCliente", aplicados.texto.trim());
        const res = await fetch(`${base}/clientes?${sp}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error((data as { error?: string }).error ?? "No se pudo cargar.");
        setClientes(data);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de conexión.");
    } finally {
      setLoading(false);
    }
  }, [base, vista, page, paramsLista, clienteSel, aplicados]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void cargar();
  }, [cargar]);

  const totalPaginas = useMemo(() => {
    const total = vista === "cliente" ? clientes?.totalReal ?? 0 : lista?.totalReal ?? 0;
    return Math.max(1, Math.ceil(total / PAGE_SIZE));
  }, [vista, clientes, lista]);

  const urlExport = useMemo(() => {
    const sp = paramsLista(vista === "historial" ? "historial" : "cartera", 1);
    sp.delete("page");
    sp.delete("pageSize");
    return `${base}/export?${sp}`;
  }, [base, paramsLista, vista]);

  function buscar() {
    setPage(1);
    setAplicados(borrador);
  }
  function limpiar() {
    setBorrador(vacio);
    setAplicados(vacio);
    setPage(1);
  }
  function abrirCliente(id: number, entidad: string) {
    setClienteSel({ id, entidad });
    setDetalle(null);
    setPage(1);
  }

  const tabCls = (activa: boolean) =>
    `rounded-lg px-3 py-1.5 text-sm ${activa ? "bg-[var(--accent)] text-white" : "border border-[var(--border)] text-[var(--text)]"}`;

  return (
    <div className="space-y-3" data-testid="cxc-panel">
      <p className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-xs text-[var(--muted)]" data-testid="cxc-rotulo" role="note">
        {ROTULO_SALDO_INFORMATIVO}
      </p>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Cuentas por cobrar">
        {([["cartera", "Cartera abierta"], ["historial", "Historial"], ["cliente", "Por cliente"]] as const).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={vista === id} className={tabCls(vista === id)} onClick={() => { setVista(id); setPage(1); if (id !== "cliente") setClienteSel(null); }}>
            {label}
          </button>
        ))}
      </div>

      <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3">
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">Cliente (texto)
            <input className={inputCls} value={borrador.texto} onChange={(e) => setBorrador({ ...borrador, texto: e.target.value })} placeholder="Nombre o razón social" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">Entidad
            <select className={inputCls} value={borrador.entidad} onChange={(e) => setBorrador({ ...borrador, entidad: e.target.value })}>
              <option value="">Todas (separadas)</option>
              {entidades.map((e) => <option key={e.id} value={e.id}>{e.codigo} — {e.nombre}</option>)}
              <option value="sin">{TEXTO_SIN_ENTIDAD}</option>
            </select>
          </label>
          {vista !== "cliente" ? (
            <>
              <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">Número de factura
                <input className={inputCls} value={borrador.numero} onChange={(e) => setBorrador({ ...borrador, numero: e.target.value })} />
              </label>
              <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">Estado financiero
                <select className={inputCls} value={borrador.estado} onChange={(e) => setBorrador({ ...borrador, estado: e.target.value })}>
                  <option value="">Todos</option>
                  {ESTADOS_FINANCIEROS_DERIVADOS.filter((x) => vista === "historial" || x !== "ANULADA").map((x) => (
                    <option key={x} value={x}>{ETIQUETA_ESTADO_DERIVADO[x]}</option>
                  ))}
                </select>
              </label>
              {vista === "historial" ? (
                <>
                  <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">Alcance
                    <select className={inputCls} value={borrador.alcance} onChange={(e) => setBorrador({ ...borrador, alcance: e.target.value as AlcanceHistorial })}>
                      {ALCANCES_HISTORIAL.map((a) => <option key={a} value={a}>{a[0].toUpperCase() + a.slice(1)}</option>)}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">Estado administrativo
                    <select className={inputCls} value={borrador.estadoAdmin} onChange={(e) => setBorrador({ ...borrador, estadoAdmin: e.target.value })}>
                      <option value="">Emitida y Anulada</option>
                      <option value="Emitida">Emitida</option>
                      <option value="Anulada">Anulada</option>
                    </select>
                  </label>
                </>
              ) : null}
              <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">Emisión desde
                <input className={inputCls} type="date" value={borrador.desde} onChange={(e) => setBorrador({ ...borrador, desde: e.target.value })} />
              </label>
              <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">Emisión hasta
                <input className={inputCls} type="date" value={borrador.hasta} onChange={(e) => setBorrador({ ...borrador, hasta: e.target.value })} />
              </label>
            </>
          ) : null}
          <button type="button" className="rounded bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white" onClick={buscar}>Buscar</button>
          <button type="button" className="rounded border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text)]" onClick={limpiar}>Limpiar filtros</button>
          {vista !== "cliente" ? (
            <a className="rounded border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text)]" href={urlExport} data-testid="cxc-exportar">
              Exportar Excel (filtro actual)
            </a>
          ) : null}
        </div>
      </section>

      {error ? <p className="text-sm text-rose-500" role="alert">{error}</p> : null}

      {vista !== "cliente" && lista ? (
        <>
          {lista.porEntidad.length ? (
            <div className="flex flex-wrap gap-2 text-xs text-[var(--muted)]" data-testid="cxc-totales">
              {lista.porEntidad.map((t) => (
                <span key={`${t.entidadId ?? "sin"}`} className="rounded border border-[var(--border)] px-2 py-1">
                  <strong className="text-[var(--text)]">{t.entidad}</strong> · {t.cantidad} doc. · original {q(t.montoOriginal)} · pagado {q(t.totalPagado)} · saldo informativo {q(t.saldoInformativo)}
                </span>
              ))}
            </div>
          ) : null}
          <div className="table-scroll rounded-xl border border-[var(--border)]">
            <table className="min-w-[1100px] w-full text-left text-sm">
              <thead className="bg-[var(--thead)] text-xs uppercase text-[var(--muted)]">
                <tr>
                  <th className="px-2 py-2">Cliente</th>
                  <th className="px-2 py-2">Factura</th>
                  <th className="px-2 py-2">Entidad</th>
                  <th className="px-2 py-2">Emisión</th>
                  <th className="px-2 py-2">Vencimiento</th>
                  <th className="px-2 py-2">Monto original</th>
                  <th className="px-2 py-2">Pagado</th>
                  <th className="px-2 py-2">Saldo informativo</th>
                  <th className="px-2 py-2">Estado</th>
                  <th className="px-2 py-2">Condición</th>
                  <th className="px-2 py-2">Retención esperada</th>
                  <th className="px-2 py-2">Neto esperado</th>
                  <th className="px-2 py-2">Último pago</th>
                  <th className="px-2 py-2">Referencia</th>
                  <th className="px-2 py-2">Confirmación bancaria</th>
                </tr>
              </thead>
              <tbody>
                {lista.filas.length === 0 ? (
                  <tr><td colSpan={15} className="px-3 py-4 text-sm text-[var(--muted)]">{loading ? "Cargando…" : "Sin facturas con estos filtros."}</td></tr>
                ) : lista.filas.map((f) => (
                  <tr key={f.facturaId} className="border-t border-[var(--border)]" data-estado={f.estadoFinanciero}>
                    <td className="px-2 py-1.5 text-xs">
                      <button type="button" className="underline" onClick={() => { setVista("cliente"); abrirCliente(f.clienteId, f.entidadId == null ? "sin" : String(f.entidadId)); }}>{f.cliente}</button>
                    </td>
                    <td className="px-2 py-1.5 font-mono text-xs">{f.numeroFactura ?? "—"}</td>
                    <td className="px-2 py-1.5 text-xs">{f.entidad}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-xs">{f.fechaEmision ?? "—"}</td>
                    <td className="px-2 py-1.5 text-xs text-[var(--muted)]">{TEXTO_VENCIMIENTO_NO_DISPONIBLE}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-xs">{q(f.montoOriginal)}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-xs">{q(f.totalPagado)}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-xs font-medium" data-testid="cxc-saldo">{f.saldoInformativo == null ? "—" : q(f.saldoInformativo)}</td>
                    <td className="px-2 py-1.5 text-xs">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium text-white ${ESTADO_CLASE[f.estadoFinanciero]}`}>{ETIQUETA_ESTADO_DERIVADO[f.estadoFinanciero]}</span>
                    </td>
                    <td className="px-2 py-1.5 text-xs">{f.condicionPago ?? "—"}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-xs">{f.retencionEsperada ? `${f.retencionEsperada.porcentaje}% · ${q(f.retencionEsperada.monto)}` : "—"}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-xs">{f.netoEsperado ? q(f.netoEsperado) : "—"}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-xs">{f.ultimaFechaPago ?? "—"}</td>
                    <td className="px-2 py-1.5 text-xs">{f.ultimaReferenciaPago ?? "—"}</td>
                    <td className="px-2 py-1.5 text-xs">
                      {f.confirmacionBancaria.ultima
                        ? `${f.confirmacionBancaria.ultima.estado === "ANULADA" ? "Anulada" : "Confirmada"} · ${q(f.confirmacionBancaria.ultima.monto)} · ${f.confirmacionBancaria.ultima.fechaAcreditacion}`
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {vista === "cliente" && !clienteSel && clientes ? (
        <div className="table-scroll rounded-xl border border-[var(--border)]">
          <table className="min-w-[800px] w-full text-left text-sm">
            <thead className="bg-[var(--thead)] text-xs uppercase text-[var(--muted)]">
              <tr>
                <th className="px-2 py-2">Cliente</th><th className="px-2 py-2">Entidad</th><th className="px-2 py-2">Facturas</th>
                <th className="px-2 py-2">Abiertas</th><th className="px-2 py-2">Pagadas</th><th className="px-2 py-2">Anuladas</th>
                <th className="px-2 py-2">Facturado (registrado)</th><th className="px-2 py-2">Pagado (registrado)</th><th className="px-2 py-2">Saldo informativo</th>
              </tr>
            </thead>
            <tbody>
              {clientes.filas.length === 0 ? (
                <tr><td colSpan={9} className="px-3 py-4 text-sm text-[var(--muted)]">{loading ? "Cargando…" : "Sin clientes con facturas registradas."}</td></tr>
              ) : clientes.filas.map((c) => (
                <tr key={`${c.clienteId}-${c.entidadId ?? "sin"}`} className="border-t border-[var(--border)]">
                  <td className="px-2 py-1.5 text-xs"><button type="button" className="underline" onClick={() => abrirCliente(c.clienteId, c.entidadId == null ? "sin" : String(c.entidadId))}>{c.cliente}</button></td>
                  <td className="px-2 py-1.5 text-xs">{c.entidad}</td>
                  <td className="px-2 py-1.5 text-xs">{c.cantidadFacturas}</td>
                  <td className="px-2 py-1.5 text-xs">{c.abiertas}</td>
                  <td className="px-2 py-1.5 text-xs">{c.pagadas}</td>
                  <td className="px-2 py-1.5 text-xs">{c.anuladas}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-xs">{q(c.totalFacturadoRegistrado)}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-xs">{q(c.totalPagadoRegistrado)}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-xs font-medium">{q(c.saldoInformativoAbierto)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {vista === "cliente" && clienteSel && detalle ? (
        <div className="space-y-3" data-testid="cxc-cliente">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="rounded border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--text)]" onClick={() => { setClienteSel(null); setDetalle(null); }}>← Todos los clientes</button>
            <h3 className="text-sm font-semibold text-[var(--text)]">{detalle.resumen.cliente}{detalle.resumen.nit ? ` · NIT ${detalle.resumen.nit}` : ""}</h3>
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            {detalle.resumen.porEntidad.map((r) => (
              <div key={r.entidadId ?? "sin"} className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3 text-xs">
                <p className="font-semibold text-[var(--text)]">{r.entidad}</p>
                <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[var(--muted)]">
                  <dt>Total facturado registrado</dt><dd className="text-right text-[var(--text)]">{q(r.totalFacturadoRegistrado)}</dd>
                  <dt>Total pagado registrado</dt><dd className="text-right text-[var(--text)]">{q(r.totalPagadoRegistrado)}</dd>
                  <dt>Saldo informativo abierto</dt><dd className="text-right font-medium text-[var(--text)]">{q(r.saldoInformativoAbierto)}</dd>
                  <dt>Facturas</dt><dd className="text-right text-[var(--text)]">{r.cantidadFacturas} ({r.abiertas} abiertas · {r.pagadas} pagadas · {r.anuladas} anuladas)</dd>
                </dl>
              </div>
            ))}
          </div>

          <section>
            <h4 className="mb-1 text-xs font-semibold uppercase text-[var(--muted)]">Facturas del cliente</h4>
            <div className="table-scroll rounded-xl border border-[var(--border)]">
              <table className="min-w-[760px] w-full text-left text-xs">
                <thead className="bg-[var(--thead)] uppercase text-[var(--muted)]"><tr><th className="px-2 py-2">Factura</th><th className="px-2 py-2">Entidad</th><th className="px-2 py-2">Emisión</th><th className="px-2 py-2">Original</th><th className="px-2 py-2">Pagado</th><th className="px-2 py-2">Saldo informativo</th><th className="px-2 py-2">Estado</th></tr></thead>
                <tbody>
                  {facturasCliente.length === 0 ? <tr><td colSpan={7} className="px-3 py-3 text-[var(--muted)]">Sin facturas.</td></tr> : facturasCliente.map((f) => (
                    <tr key={f.facturaId} className="border-t border-[var(--border)]">
                      <td className="px-2 py-1.5 font-mono">{f.numeroFactura ?? "—"}</td><td className="px-2 py-1.5">{f.entidad}</td><td className="px-2 py-1.5">{f.fechaEmision ?? "—"}</td>
                      <td className="px-2 py-1.5">{q(f.montoOriginal)}</td><td className="px-2 py-1.5">{q(f.totalPagado)}</td><td className="px-2 py-1.5">{f.saldoInformativo == null ? "—" : q(f.saldoInformativo)}</td>
                      <td className="px-2 py-1.5">{ETIQUETA_ESTADO_DERIVADO[f.estadoFinanciero]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h4 className="mb-1 text-xs font-semibold uppercase text-[var(--muted)]">Pagos asociados ({detalle.pagos.totalReal})</h4>
            <div className="table-scroll rounded-xl border border-[var(--border)]">
              <table className="min-w-[620px] w-full text-left text-xs">
                <thead className="bg-[var(--thead)] uppercase text-[var(--muted)]"><tr><th className="px-2 py-2">Fecha</th><th className="px-2 py-2">Factura</th><th className="px-2 py-2">Entidad</th><th className="px-2 py-2">Monto</th><th className="px-2 py-2">Medio</th><th className="px-2 py-2">Referencia</th></tr></thead>
                <tbody>
                  {detalle.pagos.filas.length === 0 ? <tr><td colSpan={6} className="px-3 py-3 text-[var(--muted)]">Sin pagos registrados.</td></tr> : detalle.pagos.filas.map((p) => (
                    <tr key={p.id} className="border-t border-[var(--border)]"><td className="px-2 py-1.5">{p.fechaPago}</td><td className="px-2 py-1.5 font-mono">{p.numeroFactura ?? "—"}</td><td className="px-2 py-1.5">{p.entidad}</td><td className="px-2 py-1.5">{q(p.monto)}</td><td className="px-2 py-1.5">{p.medioPago ?? "—"}</td><td className="px-2 py-1.5">{p.referencia ?? "—"}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h4 className="mb-1 text-xs font-semibold uppercase text-[var(--muted)]">Confirmaciones bancarias ({detalle.confirmaciones.totalReal}) — atributo informativo; no suman al pago ni reducen el saldo</h4>
            <div className="table-scroll rounded-xl border border-[var(--border)]">
              <table className="min-w-[700px] w-full text-left text-xs">
                <thead className="bg-[var(--thead)] uppercase text-[var(--muted)]"><tr><th className="px-2 py-2">Acreditación</th><th className="px-2 py-2">Factura</th><th className="px-2 py-2">Cuenta</th><th className="px-2 py-2">Monto confirmado</th><th className="px-2 py-2">Referencia</th><th className="px-2 py-2">Estado</th></tr></thead>
                <tbody>
                  {detalle.confirmaciones.filas.length === 0 ? <tr><td colSpan={6} className="px-3 py-3 text-[var(--muted)]">Sin confirmaciones.</td></tr> : detalle.confirmaciones.filas.map((c) => (
                    <tr key={c.id} className="border-t border-[var(--border)]"><td className="px-2 py-1.5">{c.fechaAcreditacion}</td><td className="px-2 py-1.5 font-mono">{c.numeroFactura ?? "—"}</td><td className="px-2 py-1.5">{c.banco ? `${c.banco}${c.alias ? ` · ${c.alias}` : ""}` : "—"}</td><td className="px-2 py-1.5">{q(c.monto)}</td><td className="px-2 py-1.5">{c.referencia || "—"}</td><td className="px-2 py-1.5">{c.estado === "ANULADA" ? "Anulada" : "Confirmada"}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      ) : null}

      {!(vista === "cliente" && clienteSel) ? (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--muted)]">
          <span>
            {vista === "cliente" ? `${clientes?.totalReal ?? 0} cliente(s)` : `${lista?.totalReal ?? 0} factura(s)`} · página {page} de {totalPaginas}
          </span>
          <div className="flex gap-2">
            <button type="button" className="rounded border border-[var(--border)] px-2.5 py-1 text-[var(--text)] disabled:opacity-40" disabled={loading || page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Anterior</button>
            <button type="button" className="rounded border border-[var(--border)] px-2.5 py-1 text-[var(--text)] disabled:opacity-40" disabled={loading || page >= totalPaginas} onClick={() => setPage((p) => p + 1)}>Siguiente</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
