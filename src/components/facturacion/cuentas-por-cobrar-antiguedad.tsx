"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { TEXTO_SIN_ENTIDAD } from "@/lib/facturacion/cuentas-por-cobrar-shared";
import {
  ETIQUETA_TRAMO,
  TEXTO_DIAS_VENCIDOS_NO_DISPONIBLE,
  TRAMOS_ANTIGUEDAD,
  formatearImporte,
  type RespuestaAntiguedad,
} from "@/lib/facturacion/antiguedad-cxc-shared";

/**
 * MIL-CXC-ANT-01 — Antigüedad de saldos (desde la fecha de emisión). SOLO LECTURA. El rótulo «no es morosidad» es permanente.
 * Los importes se muestran tal como llegan del servidor (cadenas con 2 decimales); nunca se suman monedas distintas.
 */

type Entidad = { id: number; codigo: string; nombre: string };
type Lista = RespuestaAntiguedad & { entidades: Entidad[] };

const PAGE_SIZE = 25;
const inputCls = "rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-xs text-[var(--text)]";
const vacio = { clienteId: "", entidad: "", moneda: "", tramo: "" };

/** Formato sobre la cadena exacta del servidor (sin Number): no se pierde ningún centavo. */
const monto = formatearImporte;

export function AntiguedadCxc({ slug }: { slug: string }) {
  const base = `/api/empresas/${slug}/facturacion/cuentas-por-cobrar/antiguedad`;
  const [borrador, setBorrador] = useState(vacio);
  const [aplicados, setAplicados] = useState(vacio);
  const [page, setPage] = useState(1);
  const [lista, setLista] = useState<Lista | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const params = useCallback(
    (conPagina: boolean) => {
      const sp = new URLSearchParams();
      if (aplicados.clienteId.trim()) sp.set("clienteId", aplicados.clienteId.trim());
      if (aplicados.entidad) sp.set("entidad", aplicados.entidad);
      if (aplicados.moneda.trim()) sp.set("moneda", aplicados.moneda.trim().toUpperCase());
      if (aplicados.tramo) sp.set("tramo", aplicados.tramo);
      if (conPagina) { sp.set("page", String(page)); sp.set("pageSize", String(PAGE_SIZE)); }
      return sp;
    },
    [aplicados, page],
  );

  const cargar = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${base}?${params(true)}`);
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "No se pudo cargar el reporte.");
      setLista(j as Lista);
    } catch (e) {
      setLista(null);
      setError(e instanceof Error ? e.message : "No se pudo cargar el reporte.");
    } finally {
      setLoading(false);
    }
  }, [base, params]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void cargar();
  }, [cargar]);

  const totalPaginas = Math.max(1, Math.ceil((lista?.totalReal ?? 0) / PAGE_SIZE));
  const [exportando, setExportando] = useState(false);
  // La exportación conserva la fecha de corte de la pantalla (validada por el servidor: solo hoy/ayer). Saldos = actuales al generar.
  const descargar = useCallback(async () => {
    if (!lista) return;
    setExportando(true);
    setError("");
    try {
      const sp = params(false);
      sp.set("corte", lista.fechaCorte);
      const res = await fetch(`${base}/export?${sp}`);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? "No se pudo generar el archivo.");
      }
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `cuentas-por-cobrar-antiguedad-${lista.fechaCorte}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo generar el archivo.");
    } finally {
      setExportando(false);
    }
  }, [base, lista, params]);
  const monedas = useMemo(() => [...new Set((lista?.totalesPorMoneda ?? []).map((t) => t.moneda))], [lista]);

  return (
    <div className="space-y-3" data-testid="cxc-antiguedad">
      <p className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-xs text-[var(--muted)]" role="note" data-testid="cxc-antiguedad-rotulo">
        {lista?.rotulo ?? "Antigüedad desde la fecha de emisión. No indica morosidad ni vencimiento."}
        {lista ? <> Fecha de corte: <strong>{lista.fechaCorte}</strong>. Días vencidos: {TEXTO_DIAS_VENCIDOS_NO_DISPONIBLE}.</> : null}
      </p>

      <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3">
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">Cliente (id)
            <input className={inputCls} inputMode="numeric" value={borrador.clienteId} onChange={(e) => setBorrador({ ...borrador, clienteId: e.target.value })} placeholder="Todos" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">Entidad
            <select className={inputCls} value={borrador.entidad} onChange={(e) => setBorrador({ ...borrador, entidad: e.target.value })}>
              <option value="">Todas</option>
              {(lista?.entidades ?? []).map((e) => <option key={e.id} value={e.id}>{e.codigo} — {e.nombre}</option>)}
              <option value="sin">{TEXTO_SIN_ENTIDAD}</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">Moneda
            <input className={inputCls} maxLength={3} value={borrador.moneda} onChange={(e) => setBorrador({ ...borrador, moneda: e.target.value })} placeholder="GTQ" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">Tramo
            <select className={inputCls} value={borrador.tramo} onChange={(e) => setBorrador({ ...borrador, tramo: e.target.value })}>
              <option value="">Todos</option>
              {TRAMOS_ANTIGUEDAD.map((t) => <option key={t} value={t}>{ETIQUETA_TRAMO[t]}</option>)}
            </select>
          </label>
          <button type="button" className="rounded bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white" onClick={() => { setPage(1); setAplicados(borrador); }}>Buscar</button>
          <button type="button" className="rounded border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text)]" onClick={() => { setBorrador(vacio); setAplicados(vacio); setPage(1); }}>Limpiar filtros</button>
          <button type="button" className="rounded border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text)] disabled:opacity-40" disabled={!lista || exportando} onClick={() => void descargar()} data-testid="cxc-antiguedad-export">{exportando ? "Generando…" : "Exportar Excel"}</button>
        </div>
        <p className="mt-2 text-xs text-[var(--muted)]" data-testid="cxc-antiguedad-nota-corte">
          El Excel conserva la fecha de corte de esta pantalla solo para calcular los días desde emisión; sus saldos son los actuales al generarlo y pueden variar si se registraron cobros entre ambas consultas. No es un saldo histórico.
        </p>
      </section>

      {error ? <p role="alert" className="rounded-lg border border-red-700 px-3 py-2 text-sm text-red-400">{error}</p> : null}
      {loading && !lista ? <p className="text-sm text-[var(--muted)]">Cargando…</p> : null}

      {lista ? (
        <>
          <section className="space-y-2" aria-label="Totales por tramo y moneda">
            {monedas.length === 0 ? <p className="text-sm text-[var(--muted)]">Sin facturas con saldo pendiente para este filtro.</p> : null}
            {monedas.map((m) => (
              <div key={m} className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--card)]">
                <table className="w-full text-sm" data-testid={`cxc-antiguedad-totales-${m}`}>
                  <caption className="px-2 py-1 text-left text-xs text-[var(--muted)]">Moneda {m}</caption>
                  <thead>
                    <tr className="text-left text-xs text-[var(--muted)]">
                      {TRAMOS_ANTIGUEDAD.map((t) => <th key={t} className="px-2 py-1.5">{ETIQUETA_TRAMO[t]}</th>)}
                      <th className="px-2 py-1.5">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      {TRAMOS_ANTIGUEDAD.map((t) => {
                        const x = lista.totalesPorTramo.find((z) => z.moneda === m && z.tramo === t);
                        return <td key={t} className="px-2 py-1.5">{x ? monto(m, x.saldo) : "—"}{x ? <span className="text-xs text-[var(--muted)]"> ({x.facturas})</span> : null}</td>;
                      })}
                      <td className="px-2 py-1.5 font-medium">{monto(m, lista.totalesPorMoneda.find((z) => z.moneda === m)?.saldo ?? "0.00")}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            ))}
          </section>

          <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--card)]">
            <table className="w-full text-sm" data-testid="cxc-antiguedad-tabla">
              <thead>
                <tr className="text-left text-xs text-[var(--muted)]">
                  <th className="px-2 py-1.5">Cliente</th><th className="px-2 py-1.5">Factura</th><th className="px-2 py-1.5">Emisión</th>
                  <th className="px-2 py-1.5">Días desde emisión</th><th className="px-2 py-1.5">Tramo</th><th className="px-2 py-1.5">Monto original</th>
                  <th className="px-2 py-1.5">Cobrado</th><th className="px-2 py-1.5">Saldo pendiente</th><th className="px-2 py-1.5">Moneda</th><th className="px-2 py-1.5">Entidad</th>
                </tr>
              </thead>
              <tbody>
                {lista.filas.map((f) => (
                  <tr key={f.facturaId} className="border-t border-[var(--border)]">
                    <td className="px-2 py-1.5">{f.cliente}</td><td className="px-2 py-1.5">{f.numeroFactura ?? "—"}</td><td className="px-2 py-1.5">{f.fechaEmision}</td>
                    <td className="px-2 py-1.5">{f.diasDesdeEmision}</td><td className="px-2 py-1.5">{ETIQUETA_TRAMO[f.tramo]}</td>
                    <td className="px-2 py-1.5">{monto(f.moneda, f.montoOriginal)}</td><td className="px-2 py-1.5">{monto(f.moneda, f.montoCobrado)}</td>
                    <td className="px-2 py-1.5 font-medium">{monto(f.moneda, f.saldoPendiente)}</td><td className="px-2 py-1.5">{f.moneda}</td><td className="px-2 py-1.5">{f.entidad}</td>
                  </tr>
                ))}
                {lista.filas.length === 0 ? <tr><td colSpan={10} className="px-2 py-4 text-center text-[var(--muted)]">Sin resultados.</td></tr> : null}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between text-xs text-[var(--muted)]">
            <span>{lista.totalReal} factura(s) · página {page} de {totalPaginas}</span>
            <span className="flex gap-2">
              <button type="button" className="rounded border border-[var(--border)] px-2.5 py-1 text-[var(--text)] disabled:opacity-40" disabled={loading || page <= 1} onClick={() => setPage((p) => p - 1)}>Anterior</button>
              <button type="button" className="rounded border border-[var(--border)] px-2.5 py-1 text-[var(--text)] disabled:opacity-40" disabled={loading || page >= totalPaginas} onClick={() => setPage((p) => p + 1)}>Siguiente</button>
            </span>
          </div>
        </>
      ) : null}
    </div>
  );
}

/** Sección plegable bajo «Cuentas por cobrar»: el reporte solo se monta (y consulta) cuando el usuario la abre. */
export function SeccionAntiguedadCxc({ slug }: { slug: string }) {
  const [abierta, setAbierta] = useState(false);
  return (
    <details className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-3" onToggle={(e) => setAbierta((e.currentTarget as HTMLDetailsElement).open)} data-testid="cxc-antiguedad-seccion">
      <summary className="cursor-pointer text-sm font-medium text-[var(--text)]">Antigüedad de saldos (desde emisión)</summary>
      {abierta ? <div className="mt-3"><AntiguedadCxc slug={slug} /></div> : null}
    </details>
  );
}
