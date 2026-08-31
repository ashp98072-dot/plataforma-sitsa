"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useEmpresaSession } from "@/lib/empresa-session";
import { tienePermiso } from "@/lib/permisos-shared";
import { hoyLocal } from "@/lib/rrhh/dates";

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
  // FACT-1-TMS-REPORTES — información REAL de FACT-1, solo lectura.
  estadoFacturacion: EstadoFacturacionViaje;
  facturaId: number | null;
  numeroFactura: string | null;
  estadoAdminFactura: "Borrador" | "Emitida" | "Anulada" | null;
  estadoFinancieroFactura: "Sin pagos" | "Pago parcial" | "Cobrado" | null;
  montoFacturadoViaje: number | null;
  montoBorradorViaje: number | null;
  totalFactura: number | null;
  totalPagadoFactura: number | null;
  saldoFactura: number | null;
};

type EstadoFacturacionViaje = "No aplica" | "Pendiente de facturación" | "En borrador de factura" | "Facturado";
const ESTADOS_FACTURACION: EstadoFacturacionViaje[] = ["Pendiente de facturación", "En borrador de factura", "Facturado"];
const ESTADOS_COBRO = ["Sin pagos", "Pago parcial", "Cobrado"] as const;

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
  viajesPendientesFacturacion: number;
  valorPendienteFacturacion: number;
  viajesFacturados: number;
  valorFacturado: number;
  facturasPendientesCobro: number;
  valorPendienteCobro: number;
  cobrado: number;
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

/** Fase J — mismo criterio: relleno sólido + texto blanco, legible en claro y oscuro. */
export function badgeFacturacion(estado: EstadoFacturacionViaje): { texto: string; clase: string } {
  if (estado === "Facturado") return { texto: "Facturado", clase: "bg-emerald-600" };
  if (estado === "En borrador de factura") return { texto: "En borrador de factura", clase: "bg-slate-600" };
  if (estado === "Pendiente de facturación") return { texto: "Pendiente de facturación", clase: "bg-amber-600" };
  return { texto: "No aplica", clase: "bg-slate-500" };
}
export function badgeCobro(estado: "Sin pagos" | "Pago parcial" | "Cobrado" | null): { texto: string; clase: string } {
  if (estado === "Cobrado") return { texto: "Cobrado", clase: "bg-emerald-600" };
  if (estado === "Pago parcial") return { texto: "Pago parcial", clase: "bg-amber-600" };
  if (estado === "Sin pagos") return { texto: "Sin pagos", clase: "bg-slate-500" };
  return { texto: "—", clase: "bg-slate-500" };
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

export type PasoStepper = { label: string; hecho: boolean; opcionalSinDato?: boolean };

/**
 * CORRECCIÓN PR #112 (HALLAZGO 4, corrección de orden visual): pasos del
 * proceso EN EL ORDEN REAL — Programado → Cargado (opcional) → En ruta →
 * Llegada registrada → Pendiente de cierre → Cerrado. "Llegada
 * registrada" y "Pendiente de cierre" son PURAMENTE derivados, nunca un
 * estado nuevo persistido (ver plan.pendiente_cierre / plan.horaLlegada).
 *
 * "Cargado" sigue siendo OPCIONAL — el flujo válido permite
 * Programado → En ruta directo, sin pasar por Cargado. Una vez que el
 * plan avanza, no queda ningún dato que diga si Cargado realmente
 * ocurrió — por eso NUNCA se marca "✓" solo porque el plan ya esté más
 * adelante (eso sería inventar un hecho). Solo se marca conocido/hecho
 * cuando el estado ACTUAL sigue siendo "Cargado"; en cualquier otro caso
 * queda `opcionalSinDato: true` (sin dato, no inferido) — no se crea
 * ningún estado nuevo persistido para rastrear esto.
 *
 * Función pura extraída para poder probar el orden/semántica sin
 * renderizar el componente (este proyecto no tiene harness de pruebas
 * de componentes React).
 */
export function pasosStepper(p: PlanReporte): PasoStepper[] {
  const llegadaRegistrada = Boolean(p.horaLlegada);
  const cargadoConocido = p.estado === "Cargado";
  return [
    { label: "Programado", hecho: true },
    { label: "Cargado (opcional)", hecho: cargadoConocido, opcionalSinDato: !cargadoConocido },
    { label: "En ruta", hecho: Boolean(p.horaSalida) },
    { label: "Llegada registrada", hecho: llegadaRegistrada },
    { label: "Pendiente de cierre", hecho: p.pendienteCierre || p.estado === "Cerrado" },
    { label: "Cerrado", hecho: p.estado === "Cerrado" },
  ];
}

/** Stepper visual del proceso. */
function Stepper({ p }: { p: PlanReporte }) {
  if (p.estado === "Cancelado") {
    return (
      <p className="rounded border border-rose-700/50 bg-rose-950/10 px-2 py-1.5 text-xs font-medium text-rose-400">
        Viaje cancelado — no sigue el flujo normal.
      </p>
    );
  }
  const pasos = pasosStepper(p);
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
            {s.hecho ? "✓" : s.opcionalSinDato ? "·" : i === idxActual ? "←" : "○"} {s.label}
          </span>
          {i < pasos.length - 1 ? <span className="text-[var(--muted)]">→</span> : null}
        </li>
      ))}
    </ol>
  );
}

/**
 * CORRECCIÓN PR #112 (HALLAZGO 1): resumen del viaje a confirmar antes de
 * cerrar — función PURA para poder probarla sin un harness de componentes
 * (este proyecto no tiene uno para React; ver precedente de pruebas a
 * nivel de rutas/lib en el resto del repo).
 */
export function resumenCierre(p: PlanReporte): {
  codigo: string;
  cliente: string;
  placa: string;
  piloto: string;
  horaSalida: string;
  horaLlegada: string;
  kmSalida: string;
  kmLlegada: string;
  evidencias: number;
  tarifa: string;
} {
  return {
    codigo: p.codigo,
    cliente: p.cliente ?? "—",
    placa: p.placa ?? "—",
    piloto: p.piloto ?? "—",
    horaSalida: fh(p.horaSalida),
    horaLlegada: fh(p.horaLlegada),
    kmSalida: p.kmSalida != null ? String(p.kmSalida) : "—",
    kmLlegada: p.kmLlegada != null ? String(p.kmLlegada) : "—",
    evidencias: p.evidencias,
    tarifa: moneda(p.tarifaComercial),
  };
}

export default function ReportesViajesPage() {
  const slug = String(useParams().slug);
  const { permisos } = useEmpresaSession();
  const puedeCerrarViaje = tienePermiso(permisos, "viajes_cerrar", "editar");

  // CORRECCIÓN PR #112 (HALLAZGO 2): fecha de HOY en Guatemala explícita
  // (hoyLocal, mismo helper que ya usa el resto del proyecto — no
  // duplicado) — new Date().toISOString() usa UTC y después de las 18:00
  // en Guatemala ya representa el día siguiente.
  const hoy = hoyLocal();
  const primerDiaMes = `${hoy.slice(0, 7)}-01`;

  const [fDesde, setFDesde] = useState(primerDiaMes);
  const [fHasta, setFHasta] = useState(hoy);
  const [fCliente, setFCliente] = useState("");
  const [fPiloto, setFPiloto] = useState("");
  const [fUnidad, setFUnidad] = useState("");
  const [fEstado, setFEstado] = useState("");
  // Fase F — DISTINTO de "soloPendientes" (operativo, abajo): esto es
  // sobre FACT-1, nunca se mezclan ambos criterios en la misma consulta.
  const [fEstadoFacturacion, setFEstadoFacturacion] = useState("");
  const [fEstadoCobro, setFEstadoCobro] = useState("");
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

  // CORRECCIÓN PR #112 (HALLAZGO 3): paginación server-side real — la
  // tabla ya no carga todo el histórico filtrado de una vez (antes: LIMIT
  // 2000 fijo, silencioso). El KPI (abajo) lo calcula el backend con
  // agregación SQL sobre TODO el filtro, independiente de esta página.
  const [page, setPage] = useState(1);
  const [pageSize] = useState(200);
  const [totalReal, setTotalReal] = useState(0);

  /** Filtros SIN paginación — comparten esta parte listado/exportador. */
  const filtrosQueryString = useCallback(() => {
    const p = new URLSearchParams();
    if (!soloPendientes) {
      if (fDesde) p.set("fechaDesde", fDesde);
      if (fHasta) p.set("fechaHasta", fHasta);
    }
    if (fCliente) p.set("clienteId", fCliente);
    if (fPiloto) p.set("pilotoId", fPiloto);
    if (fUnidad) p.set("unidadId", fUnidad);
    if (fEstado) p.set("estado", fEstado);
    if (fEstadoFacturacion) p.set("estadoFacturacion", fEstadoFacturacion);
    if (fEstadoCobro) p.set("estadoCobro", fEstadoCobro);
    if (soloPendientes) p.set("soloPendientesCierre", "1");
    if (soloCerrados) p.set("soloCerrados", "1");
    if (soloSinCerrar) p.set("soloSinCerrar", "1");
    return p;
  }, [fDesde, fHasta, fCliente, fPiloto, fUnidad, fEstado, fEstadoFacturacion, fEstadoCobro, soloPendientes, soloCerrados, soloSinCerrar]);

  /** Para exportar: SIN page/pageSize — el exportador siempre trae todo el filtro. */
  const exportQueryString = useCallback(() => filtrosQueryString().toString(), [filtrosQueryString]);

  const cargar = useCallback(async (paginaSolicitada = page) => {
    setLoading(true);
    setError("");
    try {
      const p = filtrosQueryString();
      p.set("page", String(paginaSolicitada));
      p.set("pageSize", String(pageSize));
      const res = await fetch(`/api/empresas/${slug}/tms/reportes/viajes?${p.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "No se pudo cargar el reporte.");
        return;
      }
      setPlanes((data.planes ?? []) as PlanReporte[]);
      setKpi((data.kpi ?? null) as Kpi | null);
      setTotalReal(Number(data.totalReal ?? 0));
      setPage(paginaSolicitada);
    } catch {
      setError("Error de conexión.");
    } finally {
      setLoading(false);
    }
  }, [slug, filtrosQueryString, page, pageSize]);

  // `buscarTick` dispara la carga DESPUÉS de que los setState de filtros
  // ya se aplicaron — llamar cargar() en el mismo manejador que los
  // setState leería el estado VIEJO (closure obsoleto de React). El
  // efecto sí ve el estado ya actualizado porque corre después del
  // render que aplicó esos cambios.
  const [buscarTick, setBuscarTick] = useState(0);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void cargar(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buscarTick]);

  function buscar() {
    setBuscarTick((t) => t + 1); // nuevo filtro: siempre vuelve a la primera página
  }

  function limpiarFiltros() {
    setFDesde(primerDiaMes);
    setFHasta(hoy);
    setFCliente(""); setFPiloto(""); setFUnidad(""); setFEstado("");
    setFEstadoFacturacion(""); setFEstadoCobro("");
    setSoloPendientes(false); setSoloCerrados(false); setSoloSinCerrar(false);
    setBuscarTick((t) => t + 1);
  }

  const totalPaginas = Math.max(1, Math.ceil(totalReal / pageSize));
  const desdeFila = totalReal === 0 ? 0 : (page - 1) * pageSize + 1;
  const hastaFila = Math.min(page * pageSize, totalReal);

  const [expandido, setExpandido] = useState<number | null>(null);
  const [evidenciasPorPlan, setEvidenciasPorPlan] = useState<Record<number, EvidenciaTms[]>>({});
  const [bitacoraPorPlan, setBitacoraPorPlan] = useState<Record<number, AudRow[]>>({});
  const [cargandoDetalle, setCargandoDetalle] = useState(false);
  const [cerrandoId, setCerrandoId] = useState<number | null>(null);
  const [errorCierre, setErrorCierre] = useState("");
  // CORRECCIÓN PR #112 (HALLAZGO 1): "Cerrar viaje" ya NO ejecuta el POST
  // al primer clic — solo abre esta confirmación explícita con el
  // resumen del viaje; el POST solo ocurre al pulsar "Confirmar cierre"
  // dentro de ella. Se usa el detalle expandible que la pantalla ya
  // tiene (nunca un confirm() nativo).
  const [confirmandoCierre, setConfirmandoCierre] = useState<number | null>(null);

  async function abrirDetalle(planId: number) {
    if (expandido === planId) { setExpandido(null); setConfirmandoCierre(null); return; }
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

  /** Primer clic: solo abre la confirmación (nunca ejecuta el POST todavía). */
  function pedirCierre(planId: number) {
    if (expandido !== planId) void abrirDetalle(planId);
    setConfirmandoCierre(planId);
    setErrorCierre("");
  }

  /** Segundo clic (dentro de la confirmación): el ÚNICO que ejecuta el POST. */
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
      setConfirmandoCierre(null);
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
    "Evid.", "Tarifa", "Estado",
    // Fase D — Facturación (FACT-1). "Tarifa" (arriba) sigue siendo el
    // valor comercial PROGRAMADO — "Monto fact." es el snapshot real
    // usado en la factura; no siempre coinciden (ver th title).
    "Estado factura", "No. factura", "Monto fact.", "Estado cobro",
    "Total factura", "Cobrado factura", "Saldo factura",
    "Acción",
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
          {/* Fase F — estado de FACTURACIÓN (FACT-1), distinto de "pendiente de cierre" (operativo, abajo). */}
          <label className="text-xs text-[var(--muted)]">Estado facturación
            <select className={`${inputCls} mt-0.5 block`} value={fEstadoFacturacion} onChange={(e) => setFEstadoFacturacion(e.target.value)}>
              <option value="">Todos</option>
              {ESTADOS_FACTURACION.map((e) => <option key={e} value={e}>{e}</option>)}
            </select>
          </label>
          <label className="text-xs text-[var(--muted)]">Estado cobro
            <select className={`${inputCls} mt-0.5 block`} value={fEstadoCobro} onChange={(e) => setFEstadoCobro(e.target.value)}>
              <option value="">Todos</option>
              {ESTADOS_COBRO.map((e) => <option key={e} value={e}>{e}</option>)}
            </select>
          </label>
          <button type="button" className="rounded bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white" onClick={buscar}>Buscar</button>
          <button type="button" className="rounded border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text)]" onClick={limpiarFiltros}>Limpiar filtros</button>
          <button type="button" className="rounded border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text)]" disabled={loading} onClick={() => void cargar(page)}>{loading ? "Actualizando…" : "Actualizar"}</button>
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
          <a className="rounded bg-[#334155] px-3 py-1.5 text-xs text-white" href={`/api/empresas/${slug}/tms/reportes/viajes/export?formato=xlsx&${exportQueryString()}`}>Exportar Excel (todo el filtro)</a>
          <a className="rounded bg-[#334155] px-3 py-1.5 text-xs text-white" href={`/api/empresas/${slug}/tms/reportes/viajes/export?formato=pdf&${exportQueryString()}`}>Exportar PDF (todo el filtro)</a>
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

      {/* KPI Facturación (Fase E) — agregado SQL sobre TODO el filtro; los
          valores por factura (pendiente de cobro/cobrado) se cuentan UNA
          sola vez por factura, nunca una vez por viaje (ver
          obtenerKpisReporte, src/lib/tms/reportes-viajes.ts). */}
      {kpi ? (
        <section>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Facturación (FACT-1)</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            <KpiCard label="Viajes pendientes de facturación" value={String(kpi.viajesPendientesFacturacion)} />
            <KpiCard label="Valor pendiente de facturación" value={moneda(kpi.valorPendienteFacturacion)} />
            <KpiCard label="Viajes facturados" value={String(kpi.viajesFacturados)} />
            <KpiCard label="Valor facturado" value={moneda(kpi.valorFacturado)} sub="Suma monto_asignado, solo Emitida" />
            <KpiCard label="Facturas pendientes de cobro" value={String(kpi.facturasPendientesCobro)} />
            <KpiCard label="Valor pendiente de cobro" value={moneda(kpi.valorPendienteCobro)} sub="Por factura, no por viaje" />
            <KpiCard label="Cobrado" value={moneda(kpi.cobrado)} sub="Por factura, no por viaje" />
          </div>
        </section>
      ) : null}

      {error ? <p className="text-sm text-rose-500">{error}</p> : null}

      {/* Tabla */}
      <section className="overflow-x-auto rounded-xl border border-[var(--border)]">
        <table className="min-w-[1400px] w-full text-left text-sm">
          <thead className="sticky top-0 z-10 bg-[var(--thead)] text-[var(--text)]">
            <tr>{columnas.map((c) => (
              <th key={c} className="whitespace-nowrap px-2 py-2 text-xs font-semibold" title={c === "Tarifa" ? "Valor comercial PROGRAMADO del viaje." : c === "Monto fact." ? "Snapshot real usado en la factura — no siempre coincide con la tarifa comercial." : undefined}>
                {c}
              </th>
            ))}</tr>
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
                    {(() => {
                      const bFact = badgeFacturacion(p.estadoFacturacion);
                      const bCobro = badgeCobro(p.estadoFinancieroFactura);
                      const montoFact = p.montoFacturadoViaje ?? p.montoBorradorViaje;
                      return (
                        <>
                          <td className="px-2 py-1.5 text-xs">
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium text-white ${bFact.clase}`}>{bFact.texto}</span>
                          </td>
                          <td className="px-2 py-1.5 font-mono text-xs">{p.numeroFactura ?? "—"}</td>
                          <td className="whitespace-nowrap px-2 py-1.5 text-xs">{montoFact != null ? moneda(montoFact) : "—"}</td>
                          <td className="px-2 py-1.5 text-xs">
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium text-white ${bCobro.clase}`}>{bCobro.texto}</span>
                          </td>
                          <td className="whitespace-nowrap px-2 py-1.5 text-xs">{p.totalFactura != null ? moneda(p.totalFactura) : "—"}</td>
                          <td className="whitespace-nowrap px-2 py-1.5 text-xs">{p.totalPagadoFactura != null ? moneda(p.totalPagadoFactura) : "—"}</td>
                          <td className="whitespace-nowrap px-2 py-1.5 text-xs">{p.saldoFactura != null ? moneda(p.saldoFactura) : "—"}</td>
                        </>
                      );
                    })()}
                    <td className="px-2 py-1.5 text-xs">
                      <div className="flex flex-wrap gap-1.5">
                        <button type="button" className={linkCls} onClick={() => void abrirDetalle(p.id)}>{expandido === p.id ? "Cerrar" : "Ver detalle"}</button>
                        <Link href={`/e/${slug}/programacion?plan=${p.id}`} className={linkCls}>Programación</Link>
                        <a className={linkCls} href={`/api/empresas/${slug}/tms/planes/${p.id}/reporte-pdf`}>PDF</a>
                        {p.pendienteCierre && puedeCerrarViaje ? (
                          <button type="button" className="text-emerald-500 hover:underline" onClick={() => pedirCierre(p.id)}>
                            Cerrar viaje
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                  {expandido === p.id ? (
                    <tr className="border-t border-[var(--border)] bg-[var(--panel)]">
                      <td colSpan={columnas.length} className="px-3 py-3">
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
                              confirmandoCierre === p.id ? (
                                // CORRECCIÓN PR #112 (HALLAZGO 1): confirmación
                                // explícita — el POST solo ocurre al pulsar
                                // "Confirmar cierre" aquí abajo.
                                (() => {
                                  const r = resumenCierre(p);
                                  return (
                                    <div className="mt-2 space-y-1.5 rounded border border-amber-700/60 bg-amber-950/10 p-2 text-xs">
                                      <p className="font-semibold text-amber-700">Confirmar cierre administrativo</p>
                                      <ul className="grid gap-x-4 gap-y-0.5 text-[11px] text-[var(--text)] sm:grid-cols-2">
                                        <li>Código: {r.codigo}</li>
                                        <li>Cliente: {r.cliente}</li>
                                        <li>Placa: {r.placa}</li>
                                        <li>Piloto: {r.piloto}</li>
                                        <li>Hora salida: {r.horaSalida}</li>
                                        <li>Hora llegada: {r.horaLlegada}</li>
                                        <li>Km salida: {r.kmSalida}</li>
                                        <li>Km llegada: {r.kmLlegada}</li>
                                        <li>Evidencias: {r.evidencias}</li>
                                        <li>Tarifa: {r.tarifa}</li>
                                      </ul>
                                      <p className="text-[11px] text-[var(--muted)]">Las evidencias son respaldo y no determinan el cierre.</p>
                                      {errorCierre ? <p className="text-rose-500">{errorCierre}</p> : null}
                                      <div className="flex gap-2 pt-1">
                                        <button type="button" className="rounded bg-amber-600 px-2.5 py-1 font-medium text-white disabled:opacity-50" disabled={cerrandoId === p.id} onClick={() => void cerrarViaje(p.id)}>
                                          {cerrandoId === p.id ? "Cerrando…" : "Confirmar cierre"}
                                        </button>
                                        <button type="button" className="rounded border border-[var(--border)] px-2.5 py-1 text-[var(--text)]" disabled={cerrandoId === p.id} onClick={() => { setConfirmandoCierre(null); setErrorCierre(""); }}>
                                          Cancelar
                                        </button>
                                      </div>
                                    </div>
                                  );
                                })()
                              ) : (
                                <button type="button" className="mt-2 rounded bg-amber-600 px-2.5 py-1 text-xs font-medium text-white" onClick={() => pedirCierre(p.id)}>
                                  Cerrar viaje
                                </button>
                              )
                            ) : null}
                          </div>
                        </div>

                        {/* Fase G/K — Facturación: SOLO lectura, sin
                            botones de emitir/registrar pago/anular (eso
                            vive exclusivamente en Facturación clientes). */}
                        <div className="mt-3">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">H. Facturación</p>
                          <ul className="mt-1 grid gap-x-4 gap-y-0.5 text-xs text-[var(--text)] sm:grid-cols-2 lg:grid-cols-4">
                            <li>Estado: {badgeFacturacion(p.estadoFacturacion).texto}</li>
                            <li>No. factura: {p.numeroFactura ?? "—"}</li>
                            <li>Monto asignado a este viaje: {(p.montoFacturadoViaje ?? p.montoBorradorViaje) != null ? moneda(p.montoFacturadoViaje ?? p.montoBorradorViaje) : "—"}</li>
                            <li>Estado de cobro: {badgeCobro(p.estadoFinancieroFactura).texto}</li>
                            <li>Total factura: {p.totalFactura != null ? moneda(p.totalFactura) : "—"}</li>
                            <li>Total pagado: {p.totalPagadoFactura != null ? moneda(p.totalPagadoFactura) : "—"}</li>
                            <li>Saldo: {p.saldoFactura != null ? moneda(p.saldoFactura) : "—"}</li>
                          </ul>
                          {p.facturaId != null ? (
                            <p className="mt-1 text-[11px] text-[var(--muted)]">Los importes de pago y saldo corresponden a la factura completa (puede incluir otros viajes).</p>
                          ) : null}
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

      {/* CORRECCIÓN PR #112 (HALLAZGO 3): paginación server-side — el KPI
          de arriba SIEMPRE refleja todo el filtro, esta barra solo pagina
          las filas visibles de la tabla. */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--muted)]">
        <span>{totalReal ? `Mostrando ${desdeFila}–${hastaFila} de ${totalReal} viaje(s)` : "Sin viajes con estos filtros."}</span>
        <div className="flex gap-2">
          <button type="button" className="rounded border border-[var(--border)] px-2.5 py-1 text-[var(--text)] disabled:opacity-40" disabled={loading || page <= 1} onClick={() => void cargar(page - 1)}>← Anterior</button>
          <span className="px-1 py-1">Página {page} de {totalPaginas}</span>
          <button type="button" className="rounded border border-[var(--border)] px-2.5 py-1 text-[var(--text)] disabled:opacity-40" disabled={loading || page >= totalPaginas} onClick={() => void cargar(page + 1)}>Siguiente →</button>
        </div>
      </div>
    </div>
  );
}
