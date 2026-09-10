"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { hoyLocal } from "@/lib/rrhh/dates";
import { cantidadPaginasReporte, filaReporteDiario, totalValorViajes, type ViajeDiario } from "@/lib/tms/reporte-diario-viajes";

type Catalogo = { id: number; nombre?: string; placa?: string; tipo?: string };
type Respuesta = { planes?: ViajeDiario[]; totalReal?: number };
const inputCls = "rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1.5 text-sm";
const estados = ["Programado", "Cargado", "En ruta", "Descargado", "Cerrado", "Cancelado"];
const moneda = (valor: number) => `Q${valor.toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const PAGE_SIZE = 200;

export default function ReporteDiarioViajesClient() {
  const slug = String(useParams().slug);
  const hoy = hoyLocal();
  const [desde, setDesde] = useState(hoy);
  const [hasta, setHasta] = useState(hoy);
  const [clienteId, setClienteId] = useState("");
  const [pilotoId, setPilotoId] = useState("");
  const [unidadId, setUnidadId] = useState("");
  const [estado, setEstado] = useState("");
  const [clientes, setClientes] = useState<Catalogo[]>([]);
  const [pilotos, setPilotos] = useState<Catalogo[]>([]);
  const [unidades, setUnidades] = useState<Catalogo[]>([]);
  const [viajes, setViajes] = useState<ViajeDiario[]>([]);
  const [total, setTotal] = useState(0);
  const [totalReal, setTotalReal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`/api/empresas/${slug}/tms/catalogos`).then((r) => r.json()).then((data) => {
      setClientes((data.clientes ?? []) as Catalogo[]);
      setUnidades((data.unidades ?? []) as Catalogo[]);
      setPilotos(((data.personal ?? []) as Catalogo[]).filter((p) => p.tipo === "Piloto"));
    }).catch(() => undefined);
  }, [slug]);

  const params = useCallback(() => {
    const p = new URLSearchParams({ fechaDesde: desde, fechaHasta: hasta });
    if (clienteId) p.set("clienteId", clienteId);
    if (pilotoId) p.set("pilotoId", pilotoId);
    if (unidadId) p.set("unidadId", unidadId);
    if (estado) p.set("estado", estado);
    return p;
  }, [desde, hasta, clienteId, pilotoId, unidadId, estado]);

  const cargar = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const base = params();
      base.set("page", "1");
      base.set("pageSize", String(PAGE_SIZE));
      const primeraRespuesta = await fetch(`/api/empresas/${slug}/tms/reportes/viajes?${base}`);
      const primera = await primeraRespuesta.json() as Respuesta;
      if (!primeraRespuesta.ok) throw new Error("No se pudo cargar el reporte diario.");

      const totalEsperado = Number(primera.totalReal ?? 0);
      const paginasRestantes = Math.max(0, cantidadPaginasReporte(totalEsperado, PAGE_SIZE) - 1);
      const respuestasRestantes = await Promise.all(Array.from({ length: paginasRestantes }, async (_, indice) => {
        const p = params();
        p.set("page", String(indice + 2));
        p.set("pageSize", String(PAGE_SIZE));
        const respuesta = await fetch(`/api/empresas/${slug}/tms/reportes/viajes?${p}`);
        const data = await respuesta.json() as Respuesta;
        if (!respuesta.ok) throw new Error("No se pudo cargar el rango completo del reporte diario.");
        return data.planes ?? [];
      }));
      const todosLosViajes = [...(primera.planes ?? []), ...respuestasRestantes.flat()];
      setViajes(todosLosViajes);
      setTotal(totalValorViajes(todosLosViajes));
      setTotalReal(todosLosViajes.length);
    } catch (e) { setError(e instanceof Error ? e.message : "Error de conexión."); }
    finally { setLoading(false); }
  }, [slug, params]);

  useEffect(() => {
    // La carga inicial sincroniza esta vista con el endpoint remoto.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void cargar();
  }, [cargar]);
  const exportar = (formato: "xlsx" | "pdf") => `/api/empresas/${slug}/tms/reportes/viajes/export?vista=diario&formato=${formato}&${params()}`;

  return (
    <div className="space-y-4">
      <header><p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">Operaciones · Reportes</p><h1 className="mt-1 text-2xl font-semibold">Reporte diario de viajes</h1><p className="text-sm text-[var(--muted)]">Información operativa existente y tarifa comercial histórica registrada en cada viaje.</p></header>
      <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs">Desde<input type="date" className={`${inputCls} mt-1 block`} value={desde} onChange={(e) => setDesde(e.target.value)} /></label>
          <label className="text-xs">Hasta<input type="date" className={`${inputCls} mt-1 block`} value={hasta} onChange={(e) => setHasta(e.target.value)} /></label>
          <label className="text-xs">Cliente<select className={`${inputCls} mt-1 block`} value={clienteId} onChange={(e) => setClienteId(e.target.value)}><option value="">Todos</option>{clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select></label>
          <label className="text-xs">Piloto<select className={`${inputCls} mt-1 block`} value={pilotoId} onChange={(e) => setPilotoId(e.target.value)}><option value="">Todos</option>{pilotos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select></label>
          <label className="text-xs">Unidad<select className={`${inputCls} mt-1 block`} value={unidadId} onChange={(e) => setUnidadId(e.target.value)}><option value="">Todas</option>{unidades.map((u) => <option key={u.id} value={u.id}>{u.placa}</option>)}</select></label>
          <label className="text-xs">Estado<select className={`${inputCls} mt-1 block`} value={estado} onChange={(e) => setEstado(e.target.value)}><option value="">Todos</option>{estados.map((e) => <option key={e}>{e}</option>)}</select></label>
          <button type="button" className="rounded bg-[var(--accent)] px-3 py-2 text-sm text-white" onClick={() => void cargar()}>Buscar</button>
          <a className="rounded border border-[var(--border)] px-3 py-2 text-sm" href={exportar("xlsx")}>Excel</a><a className="rounded border border-[var(--border)] px-3 py-2 text-sm" href={exportar("pdf")}>PDF</a>
        </div>
      </section>
      <p className="text-sm font-medium">Total valor de viajes: {moneda(total)} · {totalReal} viaje(s)</p>
      {error ? <p className="text-sm text-rose-500">{error}</p> : null}
      <section className="overflow-x-auto rounded-xl border border-[var(--border)]"><table className="min-w-[1100px] w-full text-left text-sm"><thead className="bg-[var(--thead)]"><tr>{["Día", "Cliente", "Unidad", "Placa", "Ruta", "Hora de salida", "Piloto", "Auxiliar 1", "Auxiliar 2", "Estado", "Tarifa comercial / valor del viaje"].map((h) => <th key={h} className="px-2 py-2 text-xs">{h}</th>)}</tr></thead><tbody>{viajes.map((v, i) => <tr key={`${v.fechaPlan}-${v.placa}-${i}`} className="border-t border-[var(--border)]">{filaReporteDiario(v).map((celda, j) => <td key={j} className="px-2 py-2 text-xs">{j === 10 && celda !== "—" ? moneda(Number(celda)) : celda}</td>)}</tr>)}</tbody></table></section>
      {!loading && !viajes.length ? <p className="text-sm text-[var(--muted)]">Sin viajes para el filtro seleccionado.</p> : null}
      {loading ? <p className="text-sm text-[var(--muted)]">Cargando…</p> : null}
    </div>
  );
}
