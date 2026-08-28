"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useEmpresaSession } from "@/lib/empresa-session";
import { tienePermiso } from "@/lib/permisos-shared";

/**
 * TMS-REPORTES-1 — Operaciones → TMS / Logística → Reportes de viajes.
 *
 * Fuente de datos (Fase A, auditada): GET /tms/reportes/viajes
 * (src/lib/tms/reportes-viajes.ts) — reutiliza EXACTAMENTE el mismo
 * criterio de "pendiente_cierre" que ya usan tms/planes/route.ts y
 * cierre-viaje.ts (derivado, nunca un estado persistido). El cierre en sí
 * sigue siendo EXCLUSIVAMENTE POST /tms/planes/[id]/cerrar con permiso
 * viajes_cerrar:editar — este archivo no crea ningún mecanismo nuevo.
 */

type Parada = {
  id: number;
  orden: number;
  lugar_nombre: string;
  tipo: string;
  requiere_evidencia: boolean;
  evidencias: number;
};

type PlanReporte = {
  id: number;
  codigo: string;
  fechaPlan: string;
  horaCarga: string | null;
  estado: string;
  pendienteCierre: boolean;
  cerradoPor: string | null;
  cerradoEn: string | null;
  clienteId: number | null;
  cliente: string | null;
  rutaCodigo: string | null;
  lugarDescargaHistorico: string | null;
  referenciaCliente: string | null;
  tipoTraslado: string | null;
  regresoEstimado: string | null;
  tarifaComercial: number | null;
  placa: string | null;
  unidadTipo: string | null;
  unidadCapacidad: string | null;
  pilotoId: number | null;
  piloto: string | null;
  auxiliares: string[];
  paradas: Parada[];
  evidencias: number;
  horaSalida: string | null;
  horaLlegada: string | null;
  kmSalida: number | null;
  kmLlegada: number | null;
  kmRecorridos: number | null;
  diasRuta: number | null;
};

type Kpi = {
  totalViajes: number;
  cerrados: number;
  pendientesCierre: number;
  enRuta: number;
  cancelados: number;
  totalEvidencias: number;
  totalKmRecorridos: number;
  valorProgramado: number;
  valorCerrado: number;
  promedioIngresoPorViaje: number;
};

type ClienteCat = { id: number; nombre: string };
type UnidadCat = { id: number; placa: string };
type PersonalCat = { id: number; nombre: string; tipo: string };

type EvidenciaTms = {
  id: number;
  tipo: string;
  parada_nombre: string | null;
  nombre: string;
  latitud: number | null;
  longitud: number | null;
  capturadoEn: string | null;
  subidoPor: string | null;
  url: string;
};

type AudRow = { id: number; usuario: string | null; accion: string; detalle: string | null; creadoEn: string };

const ESTADOS = ["Programado", "Cargado", "En ruta", "Descargado", "Cerrado", "Cancelado"];

function moneda(v: number | null): string {
  if (v == null) return "Pendiente";
  return `Q${v.toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Badges de estado: relleno SÓLIDO + texto blanco — no dependen del tema de la página, así que se ven igual en claro y oscuro (a diferencia de un texto de color pastel sobre un fondo variable). */
function badgeEstado(p: PlanReporte): { texto: string; clase: string } {
  if (p.estado === "Cerrado") return { texto: "Cerrado", clase: "bg-emerald-600" };
  if (p.estado === "Cancelado") return { texto: "Cancelado", clase: "bg-rose-600" };
  if (p.pendienteCierre) return { texto: "Pendiente de cierre", clase: "bg-amber-600" };
  if (p.estado === "En ruta") return { texto: "En ruta", clase: "bg-sky-600" };
  if (p.estado === "Cargado") return { texto: "Cargado", clase: "bg-indigo-600" };
  return { texto: p.estado, clase: "bg-slate-600" };
}

function fh(v: string | null): string {
  return v ? v.replace("T", " ") : "—";
}

const inputCls = "rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1.5 text-sm text-[var(--text)]";
const linkCls = "text-[var(--accent)] hover:underline";

function KpiCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2.5">
      <p className="text-[10px] uppercase tracking-wide text-[var(--muted)]">{label}</p>
      <p className="mt-0.5 text-lg font-semibold text-[var(--text)]">{value}</p>
      {sub ? <p className="text-[10px] text-[var(--muted)]">{sub}</p> : null}
    </div>
  );
}

/** Stepper visual del proceso — "Llegada registrada" y "Pendiente de cierre" son PURAMENTE derivados, nunca un estado nuevo persistido (ver plan.pendiente_cierre / plan.horaLlegada). */
function Stepper({ p }: { p: PlanReporte }) {
  if (p.estado === "Cancelado") {
    return (
      <p className="rounded border border-rose-700/50 bg-rose-950/10 px-2 py-1.5 text-xs font-medium text-rose-400">
        Viaje cancelado — no sigue el flujo normal.
      </p>
    );
  }
  const llegadaRegistrada = Boolean(p.horaLlegada);
  const pasos = [
    { label: "Programado", hecho: true },
    { label: "Cargado", hecho: p.estado === "Cargado" || p.estado === "En ruta" || llegadaRegistrada || p.estado === "Cerrado" },
    { label: "En ruta", hecho: Boolean(p.horaSalida) },
    { label: "Llegada registrada", hecho: llegadaRegistrada },
    { label: "Pendiente de cierre", hecho: p.pendienteCierre || p.estado === "Cerrado" },
    { label: "Cerrado", hecho: p.estado === "Cerrado" },
  ];
  const actualIdx = [...pasos].reverse().findIndex((s) => s.hecho);
  const idxActual = actualIdx === -1 ? -1 : pasos.length - 1 - actualIdx;
  return (
    <ol className="flex flex-wrap gap-x-1 gap-y-2 text-[11px]">
      {pasos.map((s, i) => (
        <li key={s.label} className="flex items-center gap-1">
          <span
            className={
              i === idxActual
                ? "font-semibold text-[var(--accent)]"
                : s.hecho
                  ? "text-[var(--text)]"
                  : "text-[var(--muted)]"
            }
          >
            {s.hecho ? "✓" : i === idxActual ? "←" : "○"} {s.label}
          </span>
          {i < pasos.length - 1 ? <span className="text-[var(--muted)]">→</span> : null}
        </li>
      ))}
    </ol>
  );
}

export default function ReportesViajesPage() {
  const slug = String(useParams().slug);
  const { permisos } = useEmpresaSession();
  const puedeCerrarViaje = tienePermiso(permisos, "viajes_cerrar", "editar");

  const hoy = new Date().toISOString().slice(0, 10);
  const primerDiaMes = `${hoy.slice(0, 7)}-01`;

  const [fDesde, setFDesde] = useState(primerDiaMes);
  const [fHasta, setFHasta] = useState(hoy);
  const [fCliente, setFCliente] = useState("");
  const [fPiloto, setFPiloto] = useState("");
  const [fUnidad, setFUnidad] = useState("");
  const [fEstado, setFEstado] = useState("");
  const [soloPendientes, setSoloPendientes] = useState(false);
  const [soloCerrados, setSoloCerrados] = useState(false);
  const [soloSinCerrar, setSoloSinCerrar] = useState(false);

  const [clientesCat, setClientesCat] = useState<ClienteCat[]>([]);
  const [unidadesCat, setUnidadesCat] = useState<UnidadCat[]>([]);
  const [pilotosCat, setPilotosCat] = useState<PersonalCat[]>([]);

  useEffect(() => {
    fetch(`/api/empresas/${slug}/tms/catalogos`)
      .then((r) => r.json())
      .then((data) => {
        setClientesCat((data.clientes ?? []) as ClienteCat[]);
        setUnidadesCat((data.unidades ?? []) as UnidadCat[]);
        setPilotosCat(((data.personal ?? []) as PersonalCat[]).filter((p) => p.tipo === "Piloto"));
      })
      .catch(() => undefined);
  }, [slug]);

  const [planes, setPlanes] = useState<PlanReporte[]>([]);
  const [kpi, setKpi] = useState<Kpi | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const queryString = useCallback(() => {
    const p = new URLSearchParams();
    if (!soloPendientes) {
      if (fDesde) p.set("fechaDesde", fDesde);
      if (fHasta) p.set("fechaHasta", fHasta);
    }
    if (fCliente) p.set("clienteId", fCliente);
    if (fPiloto) p.set("pilotoId", fPiloto);
    if (fUnidad) p.set("unidadId", fUnidad);
    if (fEstado) p.set("estado", fEstado);
    if (soloPendientes) p.set("soloPendientesCierre", "1");
    if (soloCerrados) p.set("soloCerrados", "1");
    if (soloSinCerrar) p.set("soloSinCerrar", "1");
    return p.toString();
  }, [fDesde, fHasta, fCliente, fPiloto, fUnidad, fEstado, soloPendientes, soloCerrados, soloSinCerrar]);

  const cargar = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/empresas/${slug}/tms/reportes/viajes?${queryString()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "No se pudo cargar el reporte.");
        return;
      }
      setPlanes((data.planes ?? []) as PlanReporte[]);
      setKpi((data.kpi ?? null) as Kpi | null);
    } catch {
      setError("Error de conexión.");
    } finally {
      setLoading(false);
    }
  }, [slug, queryString]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function limpiarFiltros() {
    setFDesde(primerDiaMes);
    setFHasta(hoy);
    setFCliente(""); setFPiloto(""); setFUnidad(""); setFEstado("");
    setSoloPendientes(false); setSoloCerrados(false); setSoloSinCerrar(false);
  }

  const [expandido, setExpandido] = useState<number | null>(null);
  const [evidenciasPorPlan, setEvidenciasPorPlan] = useState<Record<number, EvidenciaTms[]>>({});
  const [bitacoraPorPlan, setBitacoraPorPlan] = useState<Record<number, AudRow[]>>({});
  const [cargandoDetalle, setCargandoDetalle] = useState(false);
  const [cerrandoId, setCerrandoId] = useState<number | null>(null);
  const [errorCierre, setErrorCierre] = useState("");

  async function abrirDetalle(planId: number) {
    if (expandido === planId) { setExpandido(null); return; }
    setExpandido(planId);
    if (!evidenciasPorPlan[planId] || !bitacoraPorPlan[planId]) {
      setCargandoDetalle(true);
      try {
        const [resEv, resBit] = await Promise.all([
          fetch(`/api/empresas/${slug}/tms/evidencias?planId=${planId}`),
          fetch(`/api/empresas/${slug}/tms/planes/${planId}/bitacora`),
        ]);
        const [dataEv, dataBit] = await Promise.all([
          resEv.json().catch(() => ({})),
          resBit.json().catch(() => ({})),
        ]);
        if (resEv.ok) setEvidenciasPorPlan((a) => ({ ...a, [planId]: (dataEv.evidencias ?? []) as EvidenciaTms[] }));
        if (resBit.ok) setBitacoraPorPlan((a) => ({ ...a, [planId]: (dataBit.eventos ?? []) as AudRow[] }));
      } finally {
        setCargandoDetalle(false);
      }
    }
  }

  async function cerrarViaje(planId: number) {
    setCerrandoId(planId);
    setErrorCierre("");
    try {
      const res = await fetch(`/api/empresas/${slug}/tms/planes/${planId}/cerrar`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorCierre(data.error ?? "No se pudo cerrar el viaje.");
        return;
      }
      await cargar();
    } catch {
      setErrorCierre("Error de conexión.");
    } finally {
      setCerrandoId(null);
    }
  }

  const columnas = [
    "Código", "Fecha", "Cliente", "Ruta", "Placa", "Piloto", "Auxiliares",
    "H. salida", "H. llegada", "Km salida", "Km llegada", "Km rec.",
    "Evid.", "Tarifa", "Estado", "Acción",
  ];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-[var(--text)]">Reportes de viajes</h1>
        <p className="text-sm text-[var(--muted)]">
          TMS / Logística. Consulta administrativa de viajes con filtros, indicadores y exportación. Para crear/editar un viaje usa{" "}
          <Link href={`/e/${slug}/programacion`} className={linkCls}>Operaciones → Programación</Link>.
        </p>
      </div>

      {/* Filtros */}
      <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-[var(--muted)]">Desde
            <input type="date" className={`${inputCls} mt-0.5 block`} value={fDesde} onChange={(e) => setFDesde(e.target.value)} disabled={soloPendientes} />
          </label>
          <label className="text-xs text-[var(--muted)]">Hasta
            <input type="date" className={`${inputCls} mt-0.5 block`} value={fHasta} onChange={(e) => setFHasta(e.target.value)} disabled={soloPendientes} />
          </label>
          <label className="text-xs text-[var(--muted)]">Cliente
            <select className={`${inputCls} mt-0.5 block`} value={fCliente} onChange={(e) => setFCliente(e.target.value)}>
              <option value="">Todos</option>
              {clientesCat.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </label>
          <label className="text-xs text-[var(--muted)]">Piloto
            <select className={`${inputCls} mt-0.5 block`} value={fPiloto} onChange={(e) => setFPiloto(e.target.value)}>
              <option value="">Todos</option>
              {pilotosCat.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </label>
          <label className="text-xs text-[var(--muted)]">Unidad
            <select className={`${inputCls} mt-0.5 block`} value={fUnidad} onChange={(e) => setFUnidad(e.target.value)}>
              <option value="">Todas</option>
              {unidadesCat.map((u) => <option key={u.id} value={u.id}>{u.placa}</option>)}
            </select>
          </label>
          <label className="text-xs text-[var(--muted)]">Estado
            <select className={`${inputCls} mt-0.5 block`} value={fEstado} onChange={(e) => setFEstado(e.target.value)}>
              <option value="">Todos</option>
              {ESTADOS.map((e) => <option key={e} value={e}>{e}</option>)}
            </select>
          </label>
          <button type="button" className="rounded bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white" onClick={() => void cargar()}>Buscar</button>
          <button type="button" className="rounded border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text)]" onClick={limpiarFiltros}>Limpiar filtros</button>
          <button type="button" className="rounded border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text)]" disabled={loading} onClick={() => void cargar()}>{loading ? "Actualizando…" : "Actualizar"}</button>
        </div>
        <div className="mt-2 flex flex-wrap gap-3 text-xs">
          <label className="flex items-center gap-1 text-[var(--text)]">
            <input type="checkbox" checked={soloPendientes} onChange={(e) => { setSoloPendientes(e.target.checked); if (e.target.checked) { setSoloCerrados(false); setSoloSinCerrar(false); } }} />
            Solo pendientes de cierre
          </label>
          <label className="flex items-center gap-1 text-[var(--text)]">
            <input type="checkbox" checked={soloCerrados} onChange={(e) => { setSoloCerrados(e.target.checked); if (e.target.checked) setSoloSinCerrar(false); }} />
            Solo cerrados
          </label>
          <label className="flex items-center gap-1 text-[var(--text)]">
            <input type="checkbox" checked={soloSinCerrar} onChange={(e) => { setSoloSinCerrar(e.target.checked); if (e.target.checked) setSoloCerrados(false); }} />
            Solo sin cerrar
          </label>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <a className="rounded bg-[#334155] px-3 py-1.5 text-xs text-white" href={`/api/empresas/${slug}/tms/reportes/viajes/export?formato=xlsx&${queryString()}`}>Exportar Excel</a>
          <a className="rounded bg-[#334155] px-3 py-1.5 text-xs text-white" href={`/api/empresas/${slug}/tms/reportes/viajes/export?formato=pdf&${queryString()}`}>Exportar PDF</a>
        </div>
      </section>

      {/* KPI */}
      {kpi ? (
        <section className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          <KpiCard label="Total de viajes" value={String(kpi.totalViajes)} />
          <KpiCard label="Cerrados" value={String(kpi.cerrados)} />
          <KpiCard label="Pendientes de cierre" value={String(kpi.pendientesCierre)} />
          <KpiCard label="En ruta / Cargado" value={String(kpi.enRuta)} />
          <KpiCard label="Cancelados" value={String(kpi.cancelados)} />
          <KpiCard label="Total evidencias" value={String(kpi.totalEvidencias)} />
          <KpiCard label="Km recorridos" value={kpi.totalKmRecorridos.toLocaleString("es-GT")} />
          <KpiCard label="Valor de viajes (programado)" value={moneda(kpi.valorProgramado)} sub="Suma tarifa_comercial, no cancelados" />
          <KpiCard label="Valor cerrado" value={moneda(kpi.valorCerrado)} sub="Suma tarifa_comercial, solo Cerrado" />
          <KpiCard label="Ingreso estimado promedio" value={moneda(kpi.promedioIngresoPorViaje)} sub="Por viaje con tarifa capturada" />
        </section>
      ) : null}

      {error ? <p className="text-sm text-rose-500">{error}</p> : null}

      {/* Tabla */}
      <section className="overflow-x-auto rounded-xl border border-[var(--border)]">
        <table className="min-w-[1400px] w-full text-left text-sm">
          <thead className="sticky top-0 z-10 bg-[var(--thead)] text-[var(--text)]">
            <tr>{columnas.map((c) => <th key={c} className="whitespace-nowrap px-2 py-2 text-xs font-semibold">{c}</th>)}</tr>
          </thead>
          <tbody>
            {planes.map((p) => {
              const badge = badgeEstado(p);
              return (
                <Fragment key={p.id}>
                  <tr className="border-t border-[var(--border)] bg-[var(--card)] align-top">
                    <td className="px-2 py-1.5 font-mono text-xs">{p.codigo}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-xs">{p.fechaPlan}</td>
                    <td className="px-2 py-1.5 text-xs">{p.cliente ?? "—"}</td>
                    <td className="px-2 py-1.5 text-xs">{p.rutaCodigo ?? "—"}</td>
                    <td className="px-2 py-1.5 text-xs">{p.placa ?? "—"}</td>
                    <td className="px-2 py-1.5 text-xs">{p.piloto ?? "—"}</td>
                    <td className="px-2 py-1.5 text-xs">{p.auxiliares.join(", ") || "—"}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-xs">{fh(p.horaSalida)}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-xs">{fh(p.horaLlegada)}</td>
                    <td className="px-2 py-1.5 text-xs">{p.kmSalida ?? "—"}</td>
                    <td className="px-2 py-1.5 text-xs">{p.kmLlegada ?? "—"}</td>
                    <td className="px-2 py-1.5 text-xs">{p.kmRecorridos ?? "—"}</td>
                    <td className="px-2 py-1.5 text-xs">{p.evidencias}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-xs">{moneda(p.tarifaComercial)}</td>
                    <td className="px-2 py-1.5 text-xs">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium text-white ${badge.clase}`}>{badge.texto}</span>
                    </td>
                    <td className="px-2 py-1.5 text-xs">
                      <div className="flex flex-wrap gap-1.5">
                        <button type="button" className={linkCls} onClick={() => void abrirDetalle(p.id)}>{expandido === p.id ? "Cerrar" : "Ver detalle"}</button>
                        <Link href={`/e/${slug}/programacion?plan=${p.id}`} className={linkCls}>Programación</Link>
                        <a className={linkCls} href={`/api/empresas/${slug}/tms/planes/${p.id}/reporte-pdf`}>PDF</a>
                        {p.pendienteCierre && puedeCerrarViaje ? (
                          <button type="button" className="text-emerald-500 hover:underline disabled:opacity-50" disabled={cerrandoId === p.id} onClick={() => void cerrarViaje(p.id)}>
                            {cerrandoId === p.id ? "Cerrando…" : "Cerrar viaje"}
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                  {expandido === p.id ? (
                    <tr className="border-t border-[var(--border)] bg-[var(--panel)]">
                      <td colSpan={columnas.length} className="px-3 py-3">
                        {errorCierre ? <p className="mb-2 text-xs text-rose-500">{errorCierre}</p> : null}
                        <div className="mb-3"><Stepper p={p} /></div>
                        <div className="grid gap-4 lg:grid-cols-3">
                          <div>
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">A. Datos generales</p>
                            <ul className="mt-1 space-y-0.5 text-xs text-[var(--text)]">
                              <li>Código: {p.codigo}</li>
                              <li>Fecha: {p.fechaPlan}</li>
                              <li>Cliente: {p.cliente ?? "—"}</li>
                              <li>Ruta: {p.rutaCodigo ?? "—"}</li>
                              <li>Referencia: {p.referenciaCliente ?? "—"}</li>
                              <li>Tipo traslado: {p.tipoTraslado ?? "—"}</li>
                              <li>Tarifa comercial: {moneda(p.tarifaComercial)}</li>
                              <li>Estado: {p.estado}</li>
                            </ul>
                            <p className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">B. Personal / unidad</p>
                            <ul className="mt-1 space-y-0.5 text-xs text-[var(--text)]">
                              <li>Piloto: {p.piloto ?? "—"}</li>
                              <li>Auxiliares: {p.auxiliares.join(", ") || "—"}</li>
                              <li>Unidad: {p.placa ?? "—"}</li>
                              <li>Equipo asignado: {p.unidadTipo ? `${p.unidadTipo}${p.unidadCapacidad ? ` · ${p.unidadCapacidad}` : ""}` : "—"}</li>
                            </ul>
                          </div>
                          <div>
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">C. Operación</p>
                            <ul className="mt-1 space-y-0.5 text-xs text-[var(--text)]">
                              <li>Hora programada: {p.horaCarga ?? "—"}</li>
                              <li>Hora salida real: {fh(p.horaSalida)}</li>
                              <li>Hora llegada real: {fh(p.horaLlegada)}</li>
                              <li>Km salida: {p.kmSalida ?? "—"}</li>
                              <li>Km llegada: {p.kmLlegada ?? "—"}</li>
                              <li>Km recorridos: {p.kmRecorridos ?? "—"}</li>
                              <li>Días de ruta: {p.diasRuta ?? "—"}</li>
                              <li>Regreso estimado: {fh(p.regresoEstimado)}</li>
                            </ul>
                            <p className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">D. Paradas</p>
                            {p.paradas.length ? (
                              <ul className="mt-1 space-y-0.5 text-xs text-[var(--text)]">
                                {p.paradas.map((pp) => (
                                  <li key={pp.id}>{pp.orden}. {pp.lugar_nombre} ({pp.tipo}) — {pp.evidencias > 0 ? `${pp.evidencias} evidencia(s)` : pp.requiere_evidencia ? "sin evidencia (no bloquea)" : "no requiere"}</li>
                                ))}
                              </ul>
                            ) : <p className="mt-1 text-xs text-[var(--muted)]">Sin paradas registradas.</p>}
                          </div>
                          <div>
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">F. Cierre</p>
                            <ul className="mt-1 space-y-0.5 text-xs text-[var(--text)]">
                              <li>Pendiente de cierre: {p.pendienteCierre ? "Sí" : "No"}</li>
                              <li>Cerrado por: {p.cerradoPor ?? "—"}</li>
                              <li>Cerrado en: {fh(p.cerradoEn)}</li>
                            </ul>
                            {p.pendienteCierre && puedeCerrarViaje ? (
                              <button type="button" className="mt-2 rounded bg-amber-600 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50" disabled={cerrandoId === p.id} onClick={() => void cerrarViaje(p.id)}>
                                {cerrandoId === p.id ? "Cerrando…" : "Cerrar viaje"}
                              </button>
                            ) : null}
                          </div>
                        </div>

                        <div className="mt-3 grid gap-4 lg:grid-cols-2">
                          <div>
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">E. Evidencias — respaldo, no bloquean el cierre</p>
                            {cargandoDetalle && !evidenciasPorPlan[p.id] ? (
                              <p className="mt-1 text-xs text-[var(--muted)]">Cargando…</p>
                            ) : (evidenciasPorPlan[p.id] ?? []).length ? (
                              <ul className="mt-1 space-y-1 text-xs text-[var(--text)]">
                                {(evidenciasPorPlan[p.id] ?? []).map((ev) => (
                                  <li key={ev.id} className="border-t border-[var(--border)] pt-1 first:border-t-0 first:pt-0">
                                    <a href={ev.url} target="_blank" rel="noreferrer" className={linkCls}>{ev.tipo}</a>
                                    {ev.parada_nombre ? ` · ${ev.parada_nombre}` : ""} · {fh(ev.capturadoEn)}
                                    {ev.latitud != null && ev.longitud != null ? (
                                      <> · <a className={linkCls} href={`https://www.google.com/maps?q=${ev.latitud},${ev.longitud}`} target="_blank" rel="noreferrer">Ver ubicación</a></>
                                    ) : null}
                                  </li>
                                ))}
                              </ul>
                            ) : <p className="mt-1 text-xs text-[var(--muted)]">Sin evidencias registradas.</p>}
                          </div>
                          <div>
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">G. Bitácora</p>
                            {cargandoDetalle && !bitacoraPorPlan[p.id] ? (
                              <p className="mt-1 text-xs text-[var(--muted)]">Cargando…</p>
                            ) : (bitacoraPorPlan[p.id] ?? []).length ? (
                              <ul className="mt-1 max-h-40 space-y-1 overflow-y-auto text-xs text-[var(--text)]">
                                {(bitacoraPorPlan[p.id] ?? []).map((a) => (
                                  <li key={a.id} className="border-t border-[var(--border)] pt-1 first:border-t-0 first:pt-0">
                                    <span className="text-[var(--muted)]">{a.creadoEn}</span> · {a.usuario ?? "—"} · {a.detalle ?? a.accion}
                                  </li>
                                ))}
                              </ul>
                            ) : <p className="mt-1 text-xs text-[var(--muted)]">Sin movimientos registrados.</p>}
                          </div>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
            {!planes.length && !loading ? (
              <tr><td colSpan={columnas.length} className="px-3 py-4 text-sm text-[var(--muted)]">Sin viajes con estos filtros.</td></tr>
            ) : null}
          </tbody>
        </table>
      </section>
    </div>
  );
}
