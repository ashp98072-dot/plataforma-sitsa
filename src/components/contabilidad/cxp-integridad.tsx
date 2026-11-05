"use client";

import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import { estadoCargaVacio, formatearImporte, reducirCargaAntiguedad } from "@/lib/contabilidad/cxp/antiguedad-shared";
import { CODIGOS_INTEGRIDAD, CODIGOS_SOLO_PAGOS, ROTULO_INTEGRIDAD, type RespuestaIntegridad } from "@/lib/contabilidad/cxp/integridad-shared";

const campo = "rounded border border-[var(--border)] bg-[var(--input)] p-2 text-sm";
const boton = "rounded border border-[var(--border)] px-3 py-1 text-sm hover:bg-[var(--input)] disabled:opacity-50";
const vacio = { proveedorId: "", codigo: "", estado: "" };
const q = (v: string | null) => v === null ? "—" : formatearImporte("Q", v);
const reductor = reducirCargaAntiguedad<RespuestaIntegridad>;

export function CxpIntegridad({ slug, entidadId, onConsultarProveedor }: { slug: string; entidadId: string; onConsultarProveedor: (id: number) => void }) {
  const [borrador, setBorrador] = useState(vacio), [filtros, setFiltros] = useState(vacio);
  const [page, setPage] = useState(1);
  const [version, setVersion] = useState(0);
  const [carga, dispatch] = useReducer(reductor, estadoCargaVacio<RespuestaIntegridad>());
  const clave = useMemo(() => JSON.stringify([slug, entidadId, filtros, page, version]), [slug, entidadId, filtros, page, version]);
  const claveExportacion = useMemo(() => JSON.stringify([slug, entidadId, filtros, version]), [slug, entidadId, filtros, version]);
  const descarga = useRef<AbortController | null>(null);
  const [exportacion,setExportacion] = useState<{ clave: string; controlador: AbortController } | null>(null);
  const [errorExport,setErrorExport] = useState<{ clave: string; mensaje: string } | null>(null);
  const exportando = exportacion?.clave === claveExportacion && !exportacion.controlador.signal.aborted;
  const lista = !carga.cargando && carga.claveLista === clave ? carga.lista : null;
  const pagosVisibles = carga.lista?.pagosVisibles ?? false;
  useEffect(() => {
    const ac = new AbortController();
    const sp = new URLSearchParams({ entidad: entidadId, page: String(page), pageSize: "25" });
    for (const [k,v] of Object.entries(filtros)) if (v) sp.set(k,v);
    dispatch({ tipo: "SOLICITAR", clave });
    fetch(`/api/empresas/${slug}/contabilidad/cxp/integridad?${sp}`, { cache: "no-store", signal: ac.signal })
      .then(async res => ({ ok: res.ok, data: await res.json() }))
      .then(({ ok, data }) => {
        if (ac.signal.aborted) return;
        if (ok) dispatch({ tipo: "RESPUESTA", clave, lista: data as RespuestaIntegridad });
        else dispatch({ tipo: "FALLO", clave, error: data.error ?? "No se pudo consultar la integridad." });
      }).catch(() => { if (!ac.signal.aborted) dispatch({ tipo: "FALLO", clave, error: "No se pudo consultar la integridad." }); });
    return () => ac.abort();
  }, [slug, entidadId, filtros, page, version, clave]);
  useLayoutEffect(() => () => { descarga.current?.abort(); descarga.current = null; }, [claveExportacion]);
  async function exportar() {
    if (!lista || exportando || descarga.current) return;
    const controlador = new AbortController();
    descarga.current = controlador;
    setExportacion({ clave: claveExportacion, controlador });
    setErrorExport(null);
    let objectUrl: string | undefined;
    try {
      const sp = new URLSearchParams({ entidad: entidadId });
      for (const [k,v] of Object.entries(filtros)) if (v) sp.set(k,v);
      const res = await fetch(`/api/empresas/${slug}/contabilidad/cxp/integridad/export?${sp}`, { cache: "no-store", signal: controlador.signal });
      if (!res.ok) throw new Error((await res.json().catch(()=>({}))).error ?? "No se pudo exportar la integridad.");
      if (!res.headers.get("content-type")?.startsWith("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")) throw new Error("Archivo de exportación inválido.");
      const blob = await res.blob();
      if (controlador.signal.aborted || descarga.current !== controlador) return;
      objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = objectUrl; a.download = `cxp-integridad-entidad-${entidadId}.xlsx`;
      document.body.appendChild(a); a.click(); a.remove();
    } catch (e) {
      if (!controlador.signal.aborted && descarga.current === controlador) setErrorExport({ clave: claveExportacion, mensaje: e instanceof Error ? e.message : "No se pudo exportar la integridad." });
    } finally {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      if (descarga.current === controlador) { descarga.current = null; setExportacion(null); }
    }
  }
  const paginas = Math.max(1, Math.ceil((lista?.totalAdvertencias ?? 0) / 25));
  return <section className="space-y-3" data-testid="cxp-integridad">
    <h2 className="text-lg font-semibold">Integridad · Entidad #{entidadId}</h2>
    <p role="note" className="rounded border border-[var(--border)] p-3 text-xs text-[var(--muted)]">{ROTULO_INTEGRIDAD} Los excesos son informativos y no representan crédito ni saldo a favor.</p>
    <form className="flex flex-wrap items-end gap-2" onSubmit={e => { e.preventDefault(); descarga.current?.abort(); descarga.current = null; setFiltros({ ...borrador }); setPage(1); setVersion(v => v + 1); }}>
      <label className="text-sm">Proveedor (ID opcional)<input className={`${campo} block`} aria-label="Proveedor (ID opcional)" inputMode="numeric" value={borrador.proveedorId} onChange={e=>setBorrador({...borrador,proveedorId:e.target.value})} /></label>
      <label className="text-sm">Tipo de anomalía<select className={`${campo} block`} value={borrador.codigo} onChange={e=>setBorrador({...borrador,codigo:e.target.value})}>
        <option value="">Todas las autorizadas</option>
        {CODIGOS_INTEGRIDAD.filter(c=>pagosVisibles || !CODIGOS_SOLO_PAGOS.includes(c)).map(c=><option key={c} value={c} disabled={c === "PAGADO_NO_COINCIDE_CON_LINEAS"}>{c}{c === "PAGADO_NO_COINCIDE_CON_LINEAS" ? " (no evaluable aquí)" : ""}</option>)}
      </select></label>
      <label className="text-sm">Estado administrativo<select className={`${campo} block`} value={borrador.estado} onChange={e=>setBorrador({...borrador,estado:e.target.value})}>
        <option value="">Todos</option><option value="REGISTRADA">Registrada</option><option value="ANULADA">Anulada</option>
      </select></label>
      <button type="submit" className={boton}>Consultar</button>
      <button type="button" className={boton} disabled={!lista || exportando} onClick={exportar}>{exportando ? "Exportando…" : "Exportar Excel"}</button>
    </form>
    {carga.error && <p role="alert" className="text-sm text-red-500">{carga.error}</p>}
    {errorExport?.clave === claveExportacion && <p role="alert" className="text-sm text-red-500">{errorExport.mensaje}</p>}
    {(!lista && !carga.error) && <p role="status">Cargando revisión…</p>}
    {lista && <>
      <div className="rounded border border-[var(--border)] p-3 text-sm" role="status">
        Facturas revisadas: <strong>{lista.facturasRevisadas}</strong> de {lista.facturasEnAmbito} en el ámbito de proveedor/estado. Facturas con anomalías: <strong>{lista.facturasConAnomalias}</strong>. Advertencias: <strong>{lista.totalAdvertencias}</strong>.
        <p className="text-xs text-[var(--muted)]">El tipo de anomalía filtra los hallazgos y sus contadores; las facturas revisadas corresponden al ámbito completo de proveedor/estado. Una factura puede tener varias advertencias.</p>
        {Object.entries(lista.porCodigo).map(([codigo,n])=><span key={codigo} className="mr-3 block">{codigo}: {n}</span>)}
      </div>
      {lista.limitaciones.map(texto=><p key={texto} role="note" className="text-xs text-amber-600 dark:text-amber-400">{texto}</p>)}
      <div className="overflow-auto"><table className="w-full text-sm"><thead><tr>{["Documento", "Proveedor", "Entidad", "Estado", "Monto pagadero", "Pagado vigente", "Exceso aplicado", "Advertencia", "Consulta"].map(t=><th key={t} className="p-2 text-left">{t}</th>)}</tr></thead>
        <tbody>{lista.filas.map((r,i)=><tr key={`${r.advertencia.codigo}-${r.facturaId}-${r.pago?.id}-${i}`} className="border-t border-[var(--border)] align-top">
          <td className="p-2">{r.facturaId === null ? "Sin factura individual" : <>#{r.facturaId} · {r.documento}</>}</td>
          <td>{r.proveedor} (#{r.proveedorId})</td><td>#{r.entidadId}</td><td>{r.estadoAdmin ?? "No aplica"}</td>
          <td>{q(r.montoPagadero)}</td><td>{q(r.pagado)}</td><td>{q(r.excesoAplicado)}</td>
          <td><strong>{r.advertencia.codigo}</strong><p>{r.advertencia.mensaje}</p>
            {lista.pagosVisibles && r.pago && <small className="block">Pago #{r.pago.id} · {r.pago.estado}{r.pago.estado === "REVERSADO" ? " (no suma al pagado vigente)" : ""}.
              {r.pago.montoTotal !== null && <> Total {q(r.pago.montoTotal)}; aplicaciones {q(r.pago.sumaAplicaciones)}.</>}
              {r.pago.montoAplicado !== null && <> Aplicación {q(r.pago.montoAplicado)}.</>}
            </small>}
          </td>
          <td><button className={boton} type="button" onClick={()=>onConsultarProveedor(r.proveedorId)}>Consultar proveedor</button></td>
        </tr>)}</tbody>
      </table></div>
      {lista.filas.length === 0 && <p>Sin hallazgos en esta página de las comprobaciones disponibles. Revisa las limitaciones antes de concluir.</p>}
      <div className="flex items-center gap-2">
        <button className={boton} type="button" disabled={page<=1} onClick={()=>setPage(p=>p-1)}>Anterior</button>
        <span>Página {page} de {paginas} · {lista.totalAdvertencias} advertencias</span>
        <button className={boton} type="button" disabled={page>=paginas} onClick={()=>setPage(p=>p+1)}>Siguiente</button>
      </div>
    </>}
  </section>;
}
