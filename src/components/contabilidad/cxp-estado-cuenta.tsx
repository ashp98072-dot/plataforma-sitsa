"use client";

import { Fragment, useCallback, useEffect, useMemo, useReducer, useState } from "react";
import { ETIQUETA_SITUACION, estadoCargaVacio, formatearImporte, puedeExportarAntiguedad, reducirCargaAntiguedad } from "@/lib/contabilidad/cxp/antiguedad-shared";
import { NOTA_SIN_PERMISO_PAGOS, textoEstadoDocumento, type RespuestaEstadoCuenta } from "@/lib/contabilidad/cxp/estado-cuenta-shared";

/**
 * MIL-CXP-02 — Estado de cuenta por proveedor (saldos ACTUALES, no históricos). SOLO LECTURA.
 * Importes tal como llegan del servidor (cadenas con 2 decimales, sin Number). El detalle de pagos solo llega del servidor con permiso de Pagos.
 * La exportación se bloquea mientras hay una recarga en curso o la lista mostrada no corresponde a la solicitud vigente.
 */
type ProveedorOpcion = { id: number; nombre: string };
const PAGE_SIZE = 25;
const campo = "rounded border border-[var(--border)] bg-[var(--input)] p-2 text-sm";
const boton = "rounded border border-[var(--border)] px-3 py-1 text-sm hover:bg-[var(--input)] disabled:opacity-50";
const vacio = { proveedorId: "", incluirPagadas: false, incluirAnuladas: false, desde: "", hasta: "" };
const q = (v: string) => formatearImporte("Q", v);
const reductor = reducirCargaAntiguedad<RespuestaEstadoCuenta>;

export function CxpEstadoCuenta({ slug, entidadId }: { slug: string; entidadId: string }) {
  const base = `/api/empresas/${slug}/contabilidad/cxp`;
  const [borrador, setBorrador] = useState(vacio);
  const [aplicados, setAplicados] = useState(vacio);
  const [page, setPage] = useState(1);
  const [carga, dispatch] = useReducer(reductor, estadoCargaVacio<RespuestaEstadoCuenta>());
  const [proveedores, setProveedores] = useState<ProveedorOpcion[]>([]);
  const [exportando, setExportando] = useState(false);
  const clave = useMemo(() => JSON.stringify([entidadId, aplicados, page]), [entidadId, aplicados, page]);
  const [errorExport, setErrorExport] = useState<{ clave: string; msg: string } | null>(null);
  const hayProveedor = aplicados.proveedorId !== "";
  const lista = hayProveedor ? carga.lista : null;
  const error = carga.error || (errorExport && errorExport.clave === clave ? errorExport.msg : "");
  // Se exporta solo con la lista de la solicitud vigente, sin recarga en curso y del proveedor actualmente aplicado.
  const exportable = hayProveedor && puedeExportarAntiguedad(carga) && String(carga.lista?.proveedor.id) === aplicados.proveedorId;

  const params = useCallback((conPagina: boolean) => {
    const sp = new URLSearchParams({ entidad: entidadId, proveedorId: aplicados.proveedorId });
    if (aplicados.incluirPagadas) sp.set("incluirPagadas", "1");
    if (aplicados.incluirAnuladas) sp.set("incluirAnuladas", "1");
    if (aplicados.desde) sp.set("desde", aplicados.desde);
    if (aplicados.hasta) sp.set("hasta", aplicados.hasta);
    if (conPagina) { sp.set("page", String(page)); sp.set("pageSize", String(PAGE_SIZE)); }
    return sp;
  }, [aplicados, page, entidadId]);

  useEffect(() => {
    const ac = new AbortController();
    fetch(`${base}/proveedores?entidad=${entidadId}`, { cache: "no-store", signal: ac.signal })
      .then(async r => ({ ok: r.ok, d: await r.json() }))
      .then(({ ok, d }) => { if (!ac.signal.aborted && ok) setProveedores((d.proveedores as { id: number; nombre: string }[]).map(p => ({ id: p.id, nombre: p.nombre }))); })
      .catch(() => undefined);
    return () => ac.abort();
  }, [base, entidadId]);

  useEffect(() => {
    if (!aplicados.proveedorId) return;
    const ac = new AbortController();
    dispatch({ tipo: "SOLICITAR", clave });
    fetch(`${base}/estado-cuenta?${params(true)}`, { cache: "no-store", signal: ac.signal })
      .then(async r => ({ ok: r.ok, d: await r.json().catch(() => ({ error: "Respuesta inválida del servidor." })) }))
      .then(({ ok, d }) => {
        if (ac.signal.aborted) return;
        if (!ok) dispatch({ tipo: "FALLO", clave, error: d.error ?? "No se pudo cargar el estado de cuenta." });
        else dispatch({ tipo: "RESPUESTA", clave, lista: d as RespuestaEstadoCuenta });
      })
      .catch(() => { if (!ac.signal.aborted) dispatch({ tipo: "FALLO", clave, error: "No se pudo cargar el estado de cuenta." }); });
    return () => ac.abort();
  }, [base, params, clave, aplicados.proveedorId]);

  // La exportación conserva la fecha de corte de la pantalla (el servidor la valida: solo hoy/ayer). Los saldos son los actuales al generar el archivo.
  const descargar = useCallback(async () => {
    if (!lista || !exportable) return;
    setExportando(true);
    setErrorExport(null);
    try {
      const sp = params(false);
      sp.set("corte", lista.fechaCorte);
      const res = await fetch(`${base}/estado-cuenta/export?${sp}`, { cache: "no-store" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "No se pudo generar el archivo.");
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `cuentas-por-pagar-estado-cuenta-proveedor-${lista.proveedor.id}-${lista.fechaCorte}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setErrorExport({ clave, msg: e instanceof Error ? e.message : "No se pudo generar el archivo." });
    } finally {
      setExportando(false);
    }
  }, [base, lista, exportable, params, clave]);

  const totalPaginas = Math.max(1, Math.ceil((lista?.totalReal ?? 0) / PAGE_SIZE));
  const th = "p-2 text-left";
  const t = lista?.totales;

  return <div className="space-y-3" data-testid="cxp-estado-cuenta">
    <p className="rounded border border-[var(--border)] p-3 text-xs text-[var(--muted)]" role="note" data-testid="cxp-estado-rotulo">
      {lista?.rotulo ?? "Estado de cuenta de documentos registrados en Novalvion. Saldos actuales, no históricos. No incluye necesariamente documentos pendientes de migración desde Milenium."}
      {" "}{lista?.notaMoneda ?? "Importes en quetzales (GTQ): CxP no guarda moneda por factura."}
      {lista ? <> Fecha de corte: <strong>{lista.fechaCorte}</strong>.</> : null}
    </p>

    <div className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1 text-xs">Proveedor
        <select className={campo} value={borrador.proveedorId} onChange={e => setBorrador({ ...borrador, proveedorId: e.target.value })} aria-label="Proveedor del estado de cuenta">
          <option value="">Seleccione un proveedor</option>
          {proveedores.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </select></label>
      <label className="flex flex-col gap-1 text-xs">Documento desde
        <input type="date" className={campo} value={borrador.desde} onChange={e => setBorrador({ ...borrador, desde: e.target.value })} /></label>
      <label className="flex flex-col gap-1 text-xs">Documento hasta
        <input type="date" className={campo} value={borrador.hasta} onChange={e => setBorrador({ ...borrador, hasta: e.target.value })} /></label>
      <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={borrador.incluirPagadas} onChange={e => setBorrador({ ...borrador, incluirPagadas: e.target.checked })} />Incluir pagadas</label>
      <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={borrador.incluirAnuladas} onChange={e => setBorrador({ ...borrador, incluirAnuladas: e.target.checked })} />Incluir anuladas</label>
      <button type="button" className={boton} disabled={!borrador.proveedorId} onClick={() => { setPage(1); setAplicados(borrador); }}>Buscar</button>
      <button type="button" className={boton} onClick={() => { setBorrador(vacio); setAplicados(vacio); setPage(1); }}>Limpiar filtros</button>
      <button type="button" className={boton} disabled={!exportable || exportando} onClick={() => void descargar()} data-testid="cxp-estado-export">{exportando ? "Generando…" : "Exportar Excel"}</button>
    </div>
    <p className="text-xs text-[var(--muted)]" data-testid="cxp-estado-nota-corte">
      El Excel conserva la fecha de corte de esta pantalla solo para calcular los días; sus saldos son los actuales al generarlo y pueden variar si se registraron pagos entre ambas consultas. Las fechas del documento filtran facturas; no reconstruyen saldos a esa fecha.
    </p>

    {!hayProveedor && <p className="text-sm text-[var(--muted)]">Seleccione un proveedor y pulse Buscar. Por defecto se muestran las facturas abiertas.</p>}
    {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
    {hayProveedor && carga.cargando && !lista && <p className="text-sm text-[var(--muted)]">Cargando…</p>}

    {lista && t && <>
      <div className="rounded border border-[var(--border)] p-3 text-sm" data-testid="cxp-estado-proveedor">
        <strong>{lista.proveedor.nombre}</strong>
        {lista.proveedor.nit ? <span> · NIT {lista.proveedor.nit}</span> : null}
        {lista.proveedor.diasCredito != null ? <span> · Crédito {lista.proveedor.diasCredito} días</span> : null}
        {lista.proveedor.regimenFiscal ? <span> · Régimen {lista.proveedor.regimenFiscal === "GENERAL" ? "general" : "pequeño contribuyente"}{lista.proveedor.sujetoIsr ? " (sujeto a ISR)" : ""}</span> : null}
      </div>

      {lista.advertencias.length > 0 && <div role="alert" className="rounded border border-amber-600 p-3 text-xs" data-testid="cxp-estado-advertencias">
        <p className="font-medium">Advertencias de integridad (los importes originales no se modificaron)</p>
        <ul className="list-disc pl-5">{lista.advertencias.map((a, i) => <li key={i}>{a.codigo}: {a.mensaje}</li>)}</ul>
        {lista.advertenciasOmitidas > 0 && <p>… y {lista.advertenciasOmitidas} más sin listar.</p>}
      </div>}

      <div className="overflow-auto">
        <table className="w-full text-sm" data-testid="cxp-estado-totales">
          <caption className="p-2 text-left text-xs text-[var(--muted)]">Totales del conjunto filtrado ({t.registradas.facturas} factura(s) registradas)</caption>
          <thead><tr>{["Total de documentos", "Retención ISR", "Monto pagadero", "Pagado vigente", "Saldo exigible"].map(h => <th key={h} className={th}>{h}</th>)}</tr></thead>
          <tbody><tr>
            <td className="p-2">{q(t.registradas.totalDocumento)}</td><td className="p-2">{q(t.registradas.retencionIsr)}</td><td className="p-2">{q(t.registradas.montoPagadero)}</td>
            <td className="p-2">{q(t.registradas.pagado)}</td><td className="p-2 font-medium">{q(t.registradas.saldoExigible)}</td>
          </tr></tbody>
        </table>
        <p className="p-2 text-xs text-[var(--muted)]" data-testid="cxp-estado-resumen">
          Abiertas: {t.abiertas.facturas} · Pagadas: {t.pagadas.facturas}
          {t.sobreaplicadas.facturas > 0 ? <span> · Sobreaplicadas (revisar): {t.sobreaplicadas.facturas}, exceso aplicado {q(t.sobreaplicadas.exceso)}</span> : null}
          {t.porSituacion.map(s => <span key={s.situacion}> · {ETIQUETA_SITUACION[s.situacion]}: {q(s.saldo)} ({s.facturas})</span>)}
          {t.anuladas.facturas > 0 ? <span> · Anuladas (informativo, no suman; saldo exigible Q 0.00): {t.anuladas.facturas}, monto pagadero {q(t.anuladas.montoPagadero)}</span> : null}
        </p>
      </div>
      {!lista.pagosVisibles && <p className="text-xs text-[var(--muted)]" data-testid="cxp-estado-sin-pagos">{NOTA_SIN_PERMISO_PAGOS}</p>}

      <div className="overflow-auto">
        <table className="w-full text-sm" data-testid="cxp-estado-tabla">
          <thead><tr>{["Documento", "Fecha del documento", "Vencimiento", "Días vencidos", "Estado", "Total", "Retención ISR", "Monto pagadero", "Pagado vigente", "Saldo exigible"].map(h => <th key={h} className={th}>{h}</th>)}</tr></thead>
          <tbody>
            {lista.filas.map(f => <Fragment key={f.facturaId}>
              <tr className={`border-t border-[var(--border)] ${f.estado === "ANULADA" ? "opacity-60" : ""}`} data-estado={f.estado}>
                <td className="p-2">{f.documento}</td><td className="p-2">{f.fechaDocumento}</td><td className="p-2">{f.fechaVencimiento ?? "Sin vencimiento"}</td>
                <td className="p-2">{f.diasVencidos == null ? "—" : f.diasVencidos}</td>
                <td className={`p-2 ${f.estado === "SOBREAPLICADA" ? "font-medium text-amber-600" : ""}`}>{textoEstadoDocumento(f)}</td>
                <td className="p-2">{q(f.totalDocumento)}</td><td className="p-2">{q(f.retencionIsr)}</td><td className="p-2">{q(f.montoPagadero)}</td><td className="p-2">{q(f.pagado)}</td>
                <td className="p-2 font-medium">{q(f.saldo)}</td>
              </tr>
              {f.pagos?.map(l => <tr key={`${f.facturaId}-${l.pagoId}`} className="text-xs text-[var(--muted)]" data-linea-pago={l.estado}>
                <td className="p-2 pl-6" colSpan={2}>↳ Pago #{l.pagoId} · {l.fechaPago}</td><td className="p-2" colSpan={2}>{l.medioPago} {l.referencia ? `· ${l.referencia}` : ""}</td>
                <td className="p-2" colSpan={4}>{l.vigente ? "Registrado (suma al pagado vigente)" : `Reversado${l.reversadoEn ? ` el ${l.reversadoEn}` : ""}${l.motivoReversion ? ` · ${l.motivoReversion}` : ""} (solo información; no suma)`}</td>
                <td className="p-2">{q(l.monto)}</td><td />
              </tr>)}
            </Fragment>)}
            {lista.filas.length === 0 && <tr><td colSpan={10} className="p-4 text-center text-[var(--muted)]">Sin facturas para este filtro.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-xs text-[var(--muted)]">
        <span>{lista.totalReal} factura(s) · página {page} de {totalPaginas}</span>
        <span className="flex gap-2">
          <button type="button" className={boton} disabled={carga.cargando || page <= 1} onClick={() => setPage(p => p - 1)}>Anterior</button>
          <button type="button" className={boton} disabled={carga.cargando || page >= totalPaginas} onClick={() => setPage(p => p + 1)}>Siguiente</button>
        </span>
      </div>
    </>}
  </div>;
}
