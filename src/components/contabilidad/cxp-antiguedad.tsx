"use client";

import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import {
  ETIQUETA_SITUACION,
  ETIQUETA_TRAMO,
  SITUACIONES_VENCIMIENTO,
  TRAMOS_ANTIGUEDAD,
  estadoCargaInicial,
  formatearImporte,
  puedeExportarAntiguedad,
  reducirCargaAntiguedad,
  type RespuestaAntiguedadCxp,
} from "@/lib/contabilidad/cxp/antiguedad-shared";

/**
 * MIL-CXP-01 — Antigüedad de saldos de proveedores (desde la fecha del documento). SOLO LECTURA.
 * Importes tal como llegan del servidor (cadenas con 2 decimales, sin Number). «Días vencidos» solo con fecha de vencimiento registrada.
 */
type ProveedorOpcion = { id: number; nombre: string };
const PAGE_SIZE = 25;
const campo = "rounded border border-[var(--border)] bg-[var(--input)] p-2 text-sm";
const boton = "rounded border border-[var(--border)] px-3 py-1 text-sm hover:bg-[var(--input)] disabled:opacity-50";
const vacio = { proveedorId: "", tramo: "", situacion: "" };
const q = (v: string) => formatearImporte("Q", v);

export function CxpAntiguedad({ slug, entidadId }: { slug: string; entidadId: string }) {
  const base = `/api/empresas/${slug}/contabilidad/cxp`;
  const [borrador, setBorrador] = useState(vacio);
  const [aplicados, setAplicados] = useState(vacio);
  const [page, setPage] = useState(1);
  // Estado de carga: la exportación solo se habilita con la lista de la solicitud VIGENTE y sin recarga en curso (ver reducirCargaAntiguedad).
  const [carga, dispatch] = useReducer(reducirCargaAntiguedad, estadoCargaInicial);
  const { lista, cargando } = carga;
  const [proveedores, setProveedores] = useState<ProveedorOpcion[]>([]);
  const [exportando, setExportando] = useState(false);
  const clave = useMemo(() => JSON.stringify([entidadId, aplicados, page]), [entidadId, aplicados, page]);
  // El error de exportación pertenece a la solicitud (clave) en la que ocurrió: al cambiar filtros/página/entidad deja de mostrarse.
  const [errorExport, setErrorExport] = useState<{ clave: string; msg: string } | null>(null);
  const error = carga.error || (errorExport && errorExport.clave === clave ? errorExport.msg : "");

  const params = useCallback((conPagina: boolean) => {
    const sp = new URLSearchParams({ entidad: entidadId });
    if (aplicados.proveedorId) sp.set("proveedorId", aplicados.proveedorId);
    if (aplicados.tramo) sp.set("tramo", aplicados.tramo);
    if (aplicados.situacion) sp.set("situacion", aplicados.situacion);
    if (conPagina) { sp.set("page", String(page)); sp.set("pageSize", String(PAGE_SIZE)); }
    return sp;
  }, [aplicados, page, entidadId]);

  useEffect(() => {
    const ac = new AbortController();
    fetch(`${base}/proveedores?entidad=${entidadId}&activos=1`, { cache: "no-store", signal: ac.signal })
      .then(async r => ({ ok: r.ok, d: await r.json() }))
      .then(({ ok, d }) => { if (!ac.signal.aborted && ok) setProveedores((d.proveedores as { id: number; nombre: string }[]).map(p => ({ id: p.id, nombre: p.nombre }))); })
      .catch(() => undefined);
    return () => ac.abort();
  }, [base, entidadId]);

  useEffect(() => {
    const ac = new AbortController();
    dispatch({ tipo: "SOLICITAR", clave });
    fetch(`${base}/antiguedad?${params(true)}`, { cache: "no-store", signal: ac.signal })
      .then(async r => ({ ok: r.ok, d: await r.json().catch(() => ({ error: "Respuesta inválida del servidor." })) }))
      .then(({ ok, d }) => {
        if (ac.signal.aborted) return;
        if (!ok) dispatch({ tipo: "FALLO", clave, error: d.error ?? "No se pudo cargar el reporte." });
        else dispatch({ tipo: "RESPUESTA", clave, lista: d as RespuestaAntiguedadCxp });
      })
      .catch(() => { if (!ac.signal.aborted) dispatch({ tipo: "FALLO", clave, error: "No se pudo cargar el reporte." }); });
    return () => ac.abort();
  }, [base, params, clave]);

  // La exportación conserva la fecha de corte de la pantalla (el servidor la valida: solo hoy/ayer). Los saldos son los actuales al generar el archivo.
  const descargar = useCallback(async () => {
    if (!lista || !puedeExportarAntiguedad(carga)) return; // nunca exportar con una lista anterior o mientras se recarga
    setExportando(true);
    setErrorExport(null);
    try {
      const sp = params(false);
      sp.set("corte", lista.fechaCorte);
      const res = await fetch(`${base}/antiguedad/export?${sp}`, { cache: "no-store" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "No se pudo generar el archivo.");
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `cuentas-por-pagar-antiguedad-${lista.fechaCorte}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setErrorExport({ clave, msg: e instanceof Error ? e.message : "No se pudo generar el archivo." });
    } finally {
      setExportando(false);
    }
  }, [base, lista, carga, params, clave]);

  const totalPaginas = Math.max(1, Math.ceil((lista?.totalReal ?? 0) / PAGE_SIZE));
  const porTramo = useMemo(() => new Map((lista?.totalesPorTramo ?? []).map(t => [t.tramo, t])), [lista]);
  const th = "p-2 text-left";

  return <div className="space-y-3" data-testid="cxp-antiguedad">
    <p className="rounded border border-[var(--border)] p-3 text-xs text-[var(--muted)]" role="note" data-testid="cxp-antiguedad-rotulo">
      {lista?.rotulo ?? "Antigüedad desde la fecha del documento del proveedor. Los días vencidos solo se calculan con fecha de vencimiento."}
      {lista ? <> Fecha de corte: <strong>{lista.fechaCorte}</strong>.</> : null}
    </p>

    <div className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1 text-xs">Proveedor
        <select className={campo} value={borrador.proveedorId} onChange={e => setBorrador({ ...borrador, proveedorId: e.target.value })}>
          <option value="">Todos</option>
          {proveedores.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </select></label>
      <label className="flex flex-col gap-1 text-xs">Tramo (desde el documento)
        <select className={campo} value={borrador.tramo} onChange={e => setBorrador({ ...borrador, tramo: e.target.value })}>
          <option value="">Todos</option>
          {TRAMOS_ANTIGUEDAD.map(t => <option key={t} value={t}>{ETIQUETA_TRAMO[t]}</option>)}
        </select></label>
      <label className="flex flex-col gap-1 text-xs">Vencimiento
        <select className={campo} value={borrador.situacion} onChange={e => setBorrador({ ...borrador, situacion: e.target.value })}>
          <option value="">Todas</option>
          {SITUACIONES_VENCIMIENTO.map(s => <option key={s} value={s}>{ETIQUETA_SITUACION[s]}</option>)}
        </select></label>
      <button type="button" className={boton} onClick={() => { setPage(1); setAplicados(borrador); }}>Buscar</button>
      <button type="button" className={boton} onClick={() => { setBorrador(vacio); setAplicados(vacio); setPage(1); }}>Limpiar filtros</button>
      <button type="button" className={boton} disabled={!puedeExportarAntiguedad(carga) || exportando} onClick={() => void descargar()} data-testid="cxp-antiguedad-export">{exportando ? "Generando…" : "Exportar Excel"}</button>
    </div>
    <p className="text-xs text-[var(--muted)]" data-testid="cxp-antiguedad-nota-corte">
      El Excel conserva la fecha de corte de esta pantalla solo para calcular los días; sus saldos son los actuales al generarlo y pueden variar si se registraron pagos entre ambas consultas. No es un saldo histórico.
    </p>

    {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
    {cargando && !lista && <p className="text-sm text-[var(--muted)]">Cargando…</p>}

    {lista && <>
      <div className="overflow-auto">
        <table className="w-full text-sm" data-testid="cxp-antiguedad-totales">
          <caption className="p-2 text-left text-xs text-[var(--muted)]">Saldo pendiente por tramo (moneda: quetzales)</caption>
          <thead><tr>{TRAMOS_ANTIGUEDAD.map(t => <th key={t} className={th}>{ETIQUETA_TRAMO[t]}</th>)}<th className={th}>Total</th></tr></thead>
          <tbody><tr>
            {TRAMOS_ANTIGUEDAD.map(t => { const x = porTramo.get(t); return <td key={t} className="p-2">{x ? q(x.saldo) : "—"}{x ? <span className="text-xs text-[var(--muted)]"> ({x.facturas})</span> : null}</td>; })}
            <td className="p-2 font-medium">{q(lista.saldoTotal)}</td>
          </tr></tbody>
        </table>
        <table className="mt-2 w-full text-sm" data-testid="cxp-antiguedad-situacion">
          <caption className="p-2 text-left text-xs text-[var(--muted)]">Saldo pendiente por situación de vencimiento</caption>
          <thead><tr>{SITUACIONES_VENCIMIENTO.map(s => <th key={s} className={th}>{ETIQUETA_SITUACION[s]}</th>)}</tr></thead>
          <tbody><tr>{SITUACIONES_VENCIMIENTO.map(s => { const x = lista.totalesPorSituacion.find(z => z.situacion === s); return <td key={s} className="p-2">{x ? q(x.saldo) : "—"}{x ? <span className="text-xs text-[var(--muted)]"> ({x.facturas})</span> : null}</td>; })}</tr></tbody>
        </table>
      </div>

      <div className="overflow-auto">
        <table className="w-full text-sm" data-testid="cxp-antiguedad-tabla">
          <thead><tr>{["Proveedor", "Documento", "Fecha del documento", "Días desde el documento", "Tramo", "Vencimiento", "Días vencidos", "Total", "Retención ISR", "Monto pagadero", "Pagado", "Saldo"].map(t => <th key={t} className={th}>{t}</th>)}</tr></thead>
          <tbody>
            {lista.filas.map(f => <tr key={f.facturaId} className="border-t border-[var(--border)]">
              <td className="p-2">{f.proveedor}</td><td className="p-2">{f.serie}-{f.numero}</td><td className="p-2">{f.fechaDocumento}</td>
              <td className="p-2">{f.diasDesdeDocumento}</td><td className="p-2">{ETIQUETA_TRAMO[f.tramo]}</td>
              <td className="p-2">{f.fechaVencimiento ?? "Sin vencimiento"}</td><td className="p-2">{f.diasVencidos == null ? "—" : f.diasVencidos}</td>
              <td className="p-2">{q(f.totalDocumento)}</td><td className="p-2">{q(f.retencionIsr)}</td><td className="p-2">{q(f.montoPagadero)}</td><td className="p-2">{q(f.pagado)}</td>
              <td className="p-2 font-medium">{q(f.saldo)}</td>
            </tr>)}
            {lista.filas.length === 0 && <tr><td colSpan={12} className="p-4 text-center text-[var(--muted)]">Sin facturas con saldo pendiente para este filtro.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-xs text-[var(--muted)]">
        <span>{lista.totalReal} factura(s) · página {page} de {totalPaginas}</span>
        <span className="flex gap-2">
          <button type="button" className={boton} disabled={cargando || page <= 1} onClick={() => setPage(p => p - 1)}>Anterior</button>
          <button type="button" className={boton} disabled={cargando || page >= totalPaginas} onClick={() => setPage(p => p + 1)}>Siguiente</button>
        </span>
      </div>
    </>}
  </div>;
}
