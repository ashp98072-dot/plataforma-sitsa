"use client";
import { useCallback, useEffect, useState } from "react";

type Fila = Record<string, string | number | boolean | null>;
const tarjetas: [string, string][] = [["compradas","Canecas compradas"],["recibidas","Canecas recibidas"],["extras","Extras obtenidas (ajustes)"],["merma","Merma registrada"],["vendidas","Canecas vendidas"],["existencias","Existencias actuales"]];
const dinero: [string, string][] = [["ingresos","Ingresos netos de ventas"],["costo_ventas","Costo de las unidades vendidas"],["utilidad_bruta","Utilidad bruta"]];
const colsProducto: [string, string][] = [["producto","Caneca llena"],["compradas","Compradas"],["recibidas","Recibidas"],["extras","Extras"],["merma","Merma"],["vendidas","Vendidas"],["existencias","Existencias"],["ingresos","Ingresos"],["costo_ventas","Costo de ventas"],["utilidad_bruta","Utilidad bruta"]];
const colsVentas: [string, string][] = [["id","N.º"],["fecha","Fecha"],["documento","Documento"],["cliente","Cliente"],["producto","Caneca llena"],["cantidad","Canecas"],["precio_unitario","Precio"],["total","Importe"],["costo_fifo","Costo FIFO"],["utilidad","Utilidad"],["estado","Estado"],["anulada_por","Anuló"],["motivo_anulacion","Motivo"]];

export function ReportesComerciales({ slug }: { slug: string }) {
  const [filtros, setFiltros] = useState({ desde: "", hasta: "", producto_id: "", cliente_id: "" });
  const [catalogos, setCatalogos] = useState<{ productos: Fila[]; clientes: Fila[] }>({ productos: [], clientes: [] });
  const [resumen, setResumen] = useState<Fila | null>(null);
  const [productos, setProductos] = useState<Fila[]>([]);
  const [ventas, setVentas] = useState<Fila[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const base = `/api/empresas/${encodeURIComponent(slug)}/canecas`;
  const consultar = useCallback(async (f: typeof filtros) => {
    setCargando(true); setError("");
    const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
    const leer = async (recurso: string) => {
      const res = await fetch(`${base}/${recurso}${qs ? `?${qs}` : ""}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "No se pudo consultar el reporte.");
      return json.datos as Fila[];
    };
    try {
      const [r, p, v] = await Promise.all([leer("reporte_resumen"), leer("reporte_productos"), leer("ventas")]);
      setResumen(r[0] ?? null); setProductos(p); setVentas(v);
    } catch (e) { setError(e instanceof Error ? e.message : "Error de consulta."); setResumen(null); setProductos([]); setVentas([]); }
    finally { setCargando(false); }
  }, [base]);
  useEffect(() => {
    const t = setTimeout(() => { void (async () => {
      try {
        const cat = async (r: string) => { const res = await fetch(`${base}/${r}`, { cache: "no-store" }); return res.ok ? ((await res.json()).datos as Fila[]) : []; };
        setCatalogos({ productos: await cat("productos"), clientes: await cat("clientes") });
      } catch { /* los filtros quedan sin opciones; el reporte sigue disponible */ }
      await consultar({ desde: "", hasta: "", producto_id: "", cliente_id: "" });
    })(); }, 0);
    return () => clearTimeout(t);
  }, [base, consultar]);
  const conCostos = resumen !== null && "utilidad_bruta" in resumen;
  const soloVentas = resumen?.solo_ventas === true;
  const tabla = (columnas: [string, string][], filas: Fila[], vacio: string) => {
    const sinPermiso = (k: string) => !conCostos && ["costo_ventas", "utilidad_bruta", "costo_fifo", "utilidad"].includes(k);
    const cols = columnas.filter(([k]) => !sinPermiso(k) && (filas.length === 0 || filas.some(f => k in f)));
    return <div className="table-scroll min-w-0 max-w-full rounded-xl border border-[var(--border)] bg-[var(--card)]"><table className="w-full text-left text-sm"><thead className="bg-[var(--thead)] text-[var(--muted)]"><tr>{cols.map(([k, l]) => <th className="whitespace-nowrap px-4 py-3" key={k}>{l}</th>)}</tr></thead><tbody>{filas.map((f, i) => <tr className="border-t border-[var(--border)]" key={String(f.id ?? f.producto ?? i)}>{cols.map(([k]) => <td className="whitespace-nowrap px-4 py-3" key={k}>{String(f[k] ?? "—")}</td>)}</tr>)}{!filas.length && <tr><td colSpan={cols.length || 1} className="px-4 py-8 text-center text-[var(--muted)]">{cargando ? "Cargando…" : vacio}</td></tr>}</tbody></table></div>;
  };
  const campo = "w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2";
  return <main className="min-w-0 max-w-full space-y-6 p-4 md:p-6">
    <header><p className="text-sm font-medium text-[var(--muted)]">Gestión de Canecas</p><h1 className="mt-1 text-2xl font-semibold">Reportes comerciales</h1><p className="mt-2 text-sm text-[var(--muted)]">Todos los importes están en quetzales (Q).</p></header>
    <form className="grid min-w-0 gap-4 rounded-xl border border-[var(--border)] bg-[var(--card)] p-5 md:grid-cols-2 xl:grid-cols-5" onSubmit={e => { e.preventDefault(); void consultar(filtros); }}>
      <label className="grid gap-1.5 text-sm font-medium">Desde<input className={campo} type="date" name="desde" value={filtros.desde} onChange={e => setFiltros({ ...filtros, desde: e.target.value })} /></label>
      <label className="grid gap-1.5 text-sm font-medium">Hasta<input className={campo} type="date" name="hasta" value={filtros.hasta} onChange={e => setFiltros({ ...filtros, hasta: e.target.value })} /></label>
      <label className="grid gap-1.5 text-sm font-medium">Caneca llena<select className={campo} name="producto_id" value={filtros.producto_id} onChange={e => setFiltros({ ...filtros, producto_id: e.target.value })}><option value="">Todas</option>{catalogos.productos.map(p => <option key={String(p.id)} value={String(p.id)}>{String(p.nombre)}</option>)}</select></label>
      <label className="grid gap-1.5 text-sm font-medium">Cliente<select className={campo} name="cliente_id" value={filtros.cliente_id} onChange={e => setFiltros({ ...filtros, cliente_id: e.target.value })}><option value="">Todos</option>{catalogos.clientes.map(c => <option key={String(c.id)} value={String(c.id)}>{String(c.nombre_comercial)}{c.activo === 0 ? " (inactivo)" : ""}</option>)}</select></label>
      <button disabled={cargando} className="self-end rounded-lg bg-[var(--accent)] px-4 py-2 text-white disabled:opacity-50">Ver reporte</button>
    </form>
    {error && <p role="alert" className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-3">{error}</p>}
    {soloVentas && <p role="note" className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-3 text-sm">Con un cliente seleccionado solo se muestran los indicadores de ventas.</p>}
    {resumen && <>
      <section aria-label="Resumen" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {tarjetas.filter(([k]) => k in resumen).map(([k, l]) => <div key={k} className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4"><p className="text-sm text-[var(--muted)]">{l}</p><p className="mt-1 text-2xl font-semibold">{String(resumen[k])}</p></div>)}
        {dinero.filter(([k]) => k in resumen).map(([k, l]) => <div key={k} className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4"><p className="text-sm text-[var(--muted)]">{l}</p><p className="mt-1 text-2xl font-semibold">{String(resumen[k])}</p></div>)}
        {conCostos && "compras_valor" in resumen && <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4"><p className="text-sm text-[var(--muted)]">Compras del período</p><p className="mt-1 text-2xl font-semibold">{String(resumen.compras_valor)}</p><p className="mt-1 text-xs text-[var(--muted)]">No es el costo de las ventas: es lo comprado en el período.</p></div>}
      </section>
      <ul className="space-y-1 text-sm text-[var(--muted)]">
        {!conCostos && <li>No tiene permiso para ver costos ni utilidad.</li>}
        {Number(resumen.ventas_anuladas) > 0 && <li>Ventas anuladas en el período: {String(resumen.ventas_anuladas)} ({String(resumen.unidades_anuladas)} canecas, {String(resumen.importe_anulado)}). No se cuentan en ingresos ni en utilidad.</li>}
        {Number(resumen.existencias_con_costo_pendiente) > 0 && <li role="alert">Hay {String(resumen.existencias_con_costo_pendiente)} canecas en existencia sin costo conocido: no se pueden vender hasta registrar su costo.</li>}
        {Number(resumen.compras_sin_costo) > 0 && <li role="alert">{String(resumen.compras_sin_costo)} compras del período no tienen costo conocido y no suman en «Compras del período».</li>}
        {resumen.existencias_son_actuales === true && <li>Las existencias son las actuales, no las del final del período.</li>}
      </ul>
    </>}
    <section className="space-y-3"><h2 className="text-lg font-semibold">Por caneca</h2>{tabla(colsProducto, productos, "No hay datos para los filtros elegidos.")}</section>
    <section className="space-y-3"><h2 className="text-lg font-semibold">Historial de ventas y anulaciones</h2>{tabla(colsVentas, ventas, "No hay ventas para los filtros elegidos.")}</section>
  </main>;
}
