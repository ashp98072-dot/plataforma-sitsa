"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useEmpresaSession } from "@/lib/empresa-session";
import { tienePermiso } from "@/lib/permisos-shared";
import { hoyLocal } from "@/lib/rrhh/dates";
import { puedeCerrarManualmente, puedeCerrarNormalmente } from "@/lib/tms/cierre-viaje-shared";
import type { ResultadoCierreMasivo } from "@/lib/tms/cierre-masivo";
import type { AgrupacionPlanes } from "@/lib/tms/planes-periodo";
import {
  agruparPlanes,
  esSeleccionable,
  grupoAbierto,
  idsSeleccionables,
  notaPaginacionGrupo,
  resumenSeleccion,
  type GrupoPlanes,
} from "./planes-agrupacion";
import { formatearFechaHora12, formatearHora12 } from "@/lib/tms/hora-formato";
import { ETIQUETA_TC, etiquetaOrigenTc } from "@/lib/tms/tc-viaje-shared";
import { resumenRegreso } from "@/lib/tms/regreso-viaje";
import { textoPilotos } from "@/lib/tms/piloto-extra-comun";
import { PilotosCelda } from "@/components/tms/pilotos-celda";

/**
 * OPERACIONES-UX-PLANES-SIMPLIFICADO-1 — deep-link a un plan puntual.
 * Programación redirige aquí tras cerrar un viaje (`?plan=<id>&cerrado=1`):
 * esta pantalla es el lugar oficial del historial (Cerrados / Cancelados /
 * expediente), Programación deja de ser historial. Función pura para poder
 * probar el parseo sin renderizar (mismo criterio que el resto del repo).
 */
export function resaltadoDesdeParams(sp: {
  get(name: string): string | null;
}): { planId: number | null; bannerCierre: boolean } {
  const raw = Number(sp.get("plan"));
  const planId = Number.isInteger(raw) && raw > 0 ? raw : null;
  return { planId, bannerCierre: planId != null && sp.get("cerrado") === "1" };
}

/**
 * OPERACIONES-UX-PLANES-SIMPLIFICADO-1 (§3) — un plan Cerrado o Cancelado
 * es un EXPEDIENTE HISTÓRICO: se consulta ("Ver expediente"), no se
 * "edita programación". Los snapshots históricos (ruta_codigo_historico,
 * lugar_descarga_historico, tarifa_comercial, etc.) nunca se modifican
 * desde aquí — esta pantalla es de solo lectura salvo el cierre
 * administrativo, que ya existía.
 */
export function esExpedienteHistorico(estado: string): boolean {
  return estado === "Cerrado" || estado === "Cancelado";
}

/**
 * OPERACIONES-UX-PLANES-REPORTES-1 — el MISMO componente sirve a dos
 * pantallas sobre los MISMOS viajes / mismo backend:
 *  - `"operativo"` (/e/[slug]/planes): gestión de viajes existentes —
 *    cierre, cierre manual, salto a Programación. Sin KPIs/exportación.
 *  - `"reporte"` (/e/[slug]/reportes/viajes): consulta y análisis —
 *    indicadores, bloque de facturación y exportación Excel/PDF; la tabla
 *    es de SOLO consulta (Ver expediente + PDF), sin acciones operativas.
 * No se duplica lógica ni consultas: solo cambia qué se renderiza.
 */
export type ModoPlanesViajes = "operativo" | "reporte";

/**
 * PLANES-SEPARAR-CERRADOS — modo operativo separa los viajes en dos pestañas en vez de mezclarlos en una sola
 * tabla: "Pendientes / Activos" (estado <> 'Cerrado', reutiliza `soloSinCerrar` ya existente en el backend) y
 * "Viajes cerrados" (estado = 'Cerrado', reutiliza `soloCerrados`). Es SOLO un filtro — nunca una tabla nueva,
 * nunca mueve datos. Modo reporte NO usa esto (conserva sus 3 checkboxes de filtro de siempre).
 */
export type VistaPlanes = "ACTIVOS" | "CERRADOS";

/**
 * Qué acciones expone cada fila de la tabla según el modo. Función pura
 * (mismo criterio que el resto del repo: la lógica se prueba sin
 * renderizar el componente). En modo "reporte" nunca aparece una acción
 * que modifique el viaje — el cierre/edición sigue viviendo solo en
 * Planes / Viajes y Programación.
 */
export function accionesViaje(
  modo: ModoPlanesViajes,
  p: { estado: string; pendienteCierre: boolean; tarifaComercial: number | null },
  puedeCerrarViaje: boolean,
): { verDetalle: boolean; pdf: boolean; irProgramacion: boolean; cerrar: boolean; cierreManual: boolean; faltaTarifa: boolean } {
  const consulta = modo === "reporte";
  const historico = esExpedienteHistorico(p.estado);
  // PLANES-TARIFA-CIERRE-1 — `!== null`, NUNCA `> 0`: Q0.00 capturado explícitamente SÍ cuenta como tarifa.
  const tieneTarifa = p.tarifaComercial != null;
  // TMS-CIERRE-MASIVO-1: misma regla que cerrarViaje() en el backend (Descargado, o En ruta/Cargado con llegada).
  // `pendienteCierre` por sí solo también incluye Programado con llegada, que el backend rechaza.
  const cerrar = !consulta && puedeCerrarViaje && puedeCerrarNormalmente(p.estado, p.pendienteCierre, tieneTarifa);
  const cierreManual = !consulta && puedeCerrarViaje && puedeCerrarManualmente(p.estado, tieneTarifa);
  // Sin tarifa, pero el estado SÍ admitiría algún cierre si la tuviera — distingue "falta tarifa" de
  // "el estado no lo permite" (nunca se muestra el aviso para un viaje que de todos modos no podría cerrarse).
  const podriaConTarifa = puedeCerrarNormalmente(p.estado, p.pendienteCierre, true) || puedeCerrarManualmente(p.estado, true);
  return {
    verDetalle: true,
    pdf: true,
    irProgramacion: !consulta && !historico,
    cerrar,
    cierreManual,
    faltaTarifa: !consulta && puedeCerrarViaje && !tieneTarifa && podriaConTarifa,
  };
}

/**
 * Operaciones → Planes / Viajes (OPERACIONES-UX-PLANES-SIMPLIFICADO-1).
 * Antes vivía en Operaciones → TMS / Logística → "Reportes de viajes"
 * (TMS-REPORTES-1); se movió a /e/[slug]/planes y se retituló para que el
 * flujo operativo sea claro: Rutas → Programación → Planes / Viajes →
 * Reportes. La ruta anterior /e/[slug]/tms/reportes redirige aquí.
 *
 * Este es el lugar OFICIAL del historial de planes (Cerrados, Cancelados,
 * expediente, búsqueda histórica) y del cierre administrativo. Programación
 * quedó enfocada solo en trabajo activo/próximo.
 *
 * Fuente de datos (sin cambios): GET /tms/reportes/viajes
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
  /** Dato OPCIONAL de planificación: puede ser null. */
  regresoEstimado: string | null;
  /** Regreso REAL (flota_viajes.hora_llegada); null si no hubo llegada física. */
  regresoReal?: string | null;
  /** El cierre fue manual (sin llegada física). */
  cierreManual?: boolean;
  tarifaComercial: number | null;
  /** RUTAS-TARIFARIO-MULTIPLE-UNIDAD-RECURRENTE-1 (§3) — tarifa del catálogo usada en el viaje (snapshot). */
  tarifaId: number | null;
  tarifaNombre: string | null;
  tarifaMontoSnapshot: number | null;
  tarifaMoneda: string | null;
  placa: string | null;
  unidadTipo: string | null;
  unidadCapacidad: string | null;
  /** TMS-TC-PLANES-REPORTES-1 — TC / caja / remolque (snapshot histórico primero; ver resolverTcReporte). */
  tcPlaca?: string | null;
  tcOrigen?: "INTERNO" | "EXTERNO" | null;
  tcVehiculoId?: number | null;
  pilotoId: number | null;
  piloto: string | null;
  /** Piloto extra (si tiene): se muestra junto al principal. */
  pilotoExtra?: string | null;
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

/**
 * PLANES-CIERRE-PERIODO — filtros ya tipados (clienteId/pilotoId/unidadId como number, nunca strings crudos
 * del <select>) que respetan las acciones del período — mismo subconjunto que FiltrosCierrePeriodo en
 * cierre-masivo.ts. Usado para el body JSON del POST y (convertido a string) para el query string del GET.
 */
type FiltrosPeriodoValores = {
  clienteId?: number; pilotoId?: number; unidadId?: number; estado?: string; ruta?: string;
  estadoFacturacion?: string; estadoCobro?: string;
  soloPendientesCierre?: boolean; soloCerrados?: boolean; soloSinCerrar?: boolean;
};

/** PLANES-CIERRE-PERIODO — respuesta de GET .../planes/candidatos-cierre (vista previa antes de confirmar). */
type CandidatosCierrePeriodo = {
  periodo: { agrupacion: AgrupacionPlanes; valor: string; etiqueta: string; desde: string; hasta: string };
  total: number;
  normal: { elegibles: number; ids: number[] };
  manual: { elegibles: number; ids: number[] };
};

/** PLANES-CIERRE-PERIODO — respuesta de POST .../planes/cerrar-masivo-periodo. */
type ResultadoCierreMasivoPeriodo = ResultadoCierreMasivo & {
  agrupacion: AgrupacionPlanes;
  valor: string;
  etiqueta: string;
};

/**
 * Tipo SOLO de UI (no del backend): une el resultado del cierre por SELECCIÓN (esta página) y el cierre por
 * PERÍODO completo bajo el mismo bloque visual — "Generalizar: fecha -> período" (pedido del ticket).
 */
type ResultadoMasivoUI = Pick<ResultadoCierreMasivo, "tipo" | "solicitados" | "cerrados" | "omitidos" | "errores"> & {
  etiquetaOrigen: string;
};

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
    piloto: textoPilotos(p.piloto, p.pilotoExtra) || "—",
    // OPERACIONES-HORA-12H-1 (Grupo C) — hora REAL de salida/llegada en
    // formato 12h con AM/PM; regresoEstimado/cerradoEn (fuera de este
    // ticket) siguen usando fh() sin cambios más abajo en este archivo.
    horaSalida: formatearFechaHora12(p.horaSalida),
    horaLlegada: formatearFechaHora12(p.horaLlegada),
    kmSalida: p.kmSalida != null ? String(p.kmSalida) : "—",
    kmLlegada: p.kmLlegada != null ? String(p.kmLlegada) : "—",
    evidencias: p.evidencias,
    tarifa: moneda(p.tarifaComercial),
  };
}

export default function PlanesViajesClient({ modo = "operativo" }: { modo?: ModoPlanesViajes } = {}) {
  const slug = String(useParams().slug);
  const searchParams = useSearchParams();
  const { permisos } = useEmpresaSession();
  const puedeCerrarViaje = tienePermiso(permisos, "viajes_cerrar", "editar");
  const esReporte = modo === "reporte";

  // OPERACIONES-UX-PLANES-SIMPLIFICADO-1 — deep-link desde Programación
  // tras cerrar un viaje: se enfoca ese plan concreto (independiente de
  // fechas) y se muestra un aviso de cierre correcto.
  const focoInicial = resaltadoDesdeParams(searchParams);
  const [planFocoId, setPlanFocoId] = useState<number | null>(focoInicial.planId);
  const [bannerCierre, setBannerCierre] = useState(focoInicial.bannerCierre);

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
  // PROGRAMACION-REPORTES-FILTROS-1 — texto libre: código de ruta o
  // destino (ver `ruta` en FiltrosReporteViajes/construirCondiciones).
  const [fRuta, setFRuta] = useState("");
  // Fase F — DISTINTO de "soloPendientes" (operativo, abajo): esto es
  // sobre FACT-1, nunca se mezclan ambos criterios en la misma consulta.
  const [fEstadoFacturacion, setFEstadoFacturacion] = useState("");
  const [fEstadoCobro, setFEstadoCobro] = useState("");
  const [soloPendientes, setSoloPendientes] = useState(false);
  // PLANES-SEPARAR-CERRADOS — en modo operativo la pestaña por defecto es "Pendientes / Activos"
  // (soloSinCerrar=true desde el inicio); en modo reporte se conservan los filtros de siempre (nada activo,
  // "Todos" por defecto, como antes de este ticket).
  const [soloCerrados, setSoloCerrados] = useState(false);
  const [soloSinCerrar, setSoloSinCerrar] = useState(modo === "operativo");
  const [vista, setVista] = useState<VistaPlanes>("ACTIVOS");

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
  // Fila expandida (expediente). Declarada aquí arriba porque `cargar`
  // (más abajo) la usa para abrir automáticamente el plan del deep-link.
  const [expandido, setExpandido] = useState<number | null>(null);

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
    // Deep-link a un plan concreto (p. ej. el que se acaba de cerrar en
    // Programación): reutiliza el filtro `id` que el backend ya aplica
    // (empresa-scoped) — ignora fechas/otros filtros hasta que el usuario
    // pulse "Ver todos los planes".
    if (planFocoId != null) {
      p.set("planId", String(planFocoId));
      return p;
    }
    if (!soloPendientes) {
      if (fDesde) p.set("fechaDesde", fDesde);
      if (fHasta) p.set("fechaHasta", fHasta);
    }
    if (fCliente) p.set("clienteId", fCliente);
    if (fPiloto) p.set("pilotoId", fPiloto);
    if (fUnidad) p.set("unidadId", fUnidad);
    if (fEstado) p.set("estado", fEstado);
    if (fRuta.trim()) p.set("ruta", fRuta.trim());
    if (fEstadoFacturacion) p.set("estadoFacturacion", fEstadoFacturacion);
    if (fEstadoCobro) p.set("estadoCobro", fEstadoCobro);
    if (soloPendientes) p.set("soloPendientesCierre", "1");
    if (soloCerrados) p.set("soloCerrados", "1");
    if (soloSinCerrar) p.set("soloSinCerrar", "1");
    return p;
  }, [planFocoId, fDesde, fHasta, fCliente, fPiloto, fUnidad, fEstado, fRuta, fEstadoFacturacion, fEstadoCobro, soloPendientes, soloCerrados, soloSinCerrar]);

  /** Para exportar: SIN page/pageSize — el exportador siempre trae todo el filtro. */
  const exportQueryString = useCallback(() => filtrosQueryString().toString(), [filtrosQueryString]);

  const cargar = useCallback(async (paginaSolicitada = page) => {
    setLoading(true);
    setError("");
    // Nunca cerrar viajes que ya no están visibles: cualquier carga (filtros, página, rango, búsqueda, recarga tras cerrar) limpia la selección.
    setSeleccion(new Set());
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
      const filas = (data.planes ?? []) as PlanReporte[];
      setPlanes(filas);
      setKpi((data.kpi ?? null) as Kpi | null);
      setTotalReal(Number(data.totalReal ?? 0));
      setPage(paginaSolicitada);
      // Deep-link (?plan=<id>): abre el expediente de ese plan en cuanto
      // el listado lo trae — "muestra o resalta el plan recién cerrado".
      if (planFocoId != null && filas.some((p) => p.id === planFocoId)) {
        setExpandido(planFocoId);
      }
    } catch {
      setError("Error de conexión.");
    } finally {
      setLoading(false);
    }
  }, [slug, filtrosQueryString, page, pageSize, planFocoId]);

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
    setPlanFocoId(null); // aplicar filtros normales sale del modo "plan concreto"
    setBannerCierre(false);
    setBuscarTick((t) => t + 1); // nuevo filtro: siempre vuelve a la primera página
  }

  /**
   * PLANES-SEPARAR-CERRADOS — filtros de estado que corresponden a cada pestaña (solo modo operativo; reutiliza
   * `soloCerrados`/`soloSinCerrar`, ya existentes en el backend — nunca un filtro nuevo). CERRADOS fuerza
   * `soloPendientes=false` (no tiene sentido combinarlo con "solo cerrados") y fija el select Estado en
   * "Cerrado" (disabled, ver JSX); ACTIVOS nunca ofrece "Cerrado" como opción y limpia el Estado si venía de la
   * pestaña de cerrados (evitaría la combinación imposible `estado='Cerrado' AND estado<>'Cerrado'`).
   */
  function aplicarFiltrosDeVista(v: VistaPlanes) {
    if (v === "CERRADOS") {
      setSoloCerrados(true);
      setSoloSinCerrar(false);
      setSoloPendientes(false);
      setFEstado("Cerrado");
    } else {
      setSoloSinCerrar(true);
      setSoloCerrados(false);
      setFEstado((prev) => (prev === "Cerrado" ? "" : prev));
    }
  }

  /** Cambiar de pestaña: aplica sus filtros, sale de cualquier deep-link, limpia selección de cierre masivo, vuelve a la página 1. */
  function irAVista(nuevaVista: VistaPlanes) {
    setVista(nuevaVista);
    aplicarFiltrosDeVista(nuevaVista);
    setPlanFocoId(null);
    setBannerCierre(false);
    setSeleccion(new Set());
    setBuscarTick((t) => t + 1);
  }

  function limpiarFiltros() {
    setFDesde(primerDiaMes);
    setFHasta(hoy);
    setFCliente(""); setFPiloto(""); setFUnidad(""); setFRuta("");
    setFEstadoFacturacion(""); setFEstadoCobro("");
    setSoloPendientes(false);
    if (modo === "operativo") {
      // Nunca deja soloSinCerrar/soloCerrados en false/false: eso mezclaría de nuevo activos y cerrados en la
      // misma pestaña — "Limpiar filtros" reaplica los de la pestaña ACTUAL, no los apaga.
      aplicarFiltrosDeVista(vista);
    } else {
      setFEstado("");
      setSoloCerrados(false);
      setSoloSinCerrar(false);
    }
    setPlanFocoId(null);
    setBannerCierre(false);
    setBuscarTick((t) => t + 1);
  }

  /** Sale del modo "plan concreto" y vuelve a la lista completa con filtros. */
  function verTodosLosPlanes() {
    setPlanFocoId(null);
    setBannerCierre(false);
    setBuscarTick((t) => t + 1);
  }

  const totalPaginas = Math.max(1, Math.ceil(totalReal / pageSize));
  const desdeFila = totalReal === 0 ? 0 : (page - 1) * pageSize + 1;
  const hastaFila = Math.min(page * pageSize, totalReal);

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

  // TMS-CIERRE-OPERACIONES-1 — cierre MANUAL/forzado: mismo permiso
  // viajes_cerrar:editar, disponible aunque el piloto nunca haya
  // completado el flujo. Deliberadamente separado de confirmandoCierre
  // (el cierre normal) — nunca se fusionan ambos flujos.
  const [cierreManualPlanId, setCierreManualPlanId] = useState<number | null>(null);
  const [motivoManual, setMotivoManual] = useState("");
  const [comentarioManual, setComentarioManual] = useState("");
  const [enviandoManual, setEnviandoManual] = useState(false);
  const [errorManual, setErrorManual] = useState("");

  // TMS-CIERRE-MASIVO-1 — selección (UNA por pantalla; cada botón masivo recalcula qué seleccionados admite),
  // grupos por fecha expandidos/contraídos y cierre masivo (NORMAL o MANUAL, botones separados). Este flujo de
  // "Cerrar seleccionados"/"Cierre manual masivo" se CONSERVA sin cambios: solo cierra lo marcado con checkbox
  // EN ESTA PÁGINA — es un concepto separado de "Cerrar elegibles del período" (más abajo), que ignora la
  // selección y resuelve TODO el período server-side (ver PLANES-CIERRE-PERIODO).
  const [seleccion, setSeleccion] = useState<Set<number>>(new Set());
  const [togglesGrupo, setTogglesGrupo] = useState<Record<string, boolean>>({});
  const [masivo, setMasivo] = useState<{ tipo: "NORMAL" | "MANUAL"; clave: string } | null>(null);
  const [motivoMasivo, setMotivoMasivo] = useState("");
  const [comentarioMasivo, setComentarioMasivo] = useState("");
  const [enviandoMasivo, setEnviandoMasivo] = useState(false);
  const [errorMasivo, setErrorMasivo] = useState("");

  // PLANES-CIERRE-PERIODO — selector de agrupación (Día/Semana/Mes, default Día). Independiente de los
  // filtros de fecha del listado (fDesde/fHasta): agrupa lo YA CARGADO en esta página, nunca decide qué cerrar.
  const [modoAgrupacion, setModoAgrupacion] = useState<AgrupacionPlanes>("DIA");
  useEffect(() => {
    // Cambiar de Día/Semana/Mes cambia por completo las claves de grupo — una selección vieja podría quedar
    // referida a un grupo que ya no existe con ese formato; se limpia por seguridad (mismo criterio que ya
    // aplica cargar() al cambiar cualquier otro filtro operativo).
    setSeleccion(new Set());
  }, [modoAgrupacion]);

  // PLANES-CIERRE-PERIODO — "Cerrar elegibles del período" / "Cierre manual del período": acción DEL GRUPO
  // COMPLETO (Día/Semana/Mes), resuelta SIEMPRE server-side (candidatos-cierre al abrir, cerrar-masivo-periodo
  // al confirmar) — nunca depende de `seleccion` ni de qué página está cargada. Deshabilitada con `?plan=<id>`
  // activo (el usuario debe volver a "Ver todos los planes") y en modo reporte (sin acciones operativas).
  const [periodoAccion, setPeriodoAccion] = useState<{ tipo: "NORMAL" | "MANUAL"; clave: string } | null>(null);
  const [candidatosPeriodo, setCandidatosPeriodo] = useState<CandidatosCierrePeriodo | null>(null);
  const [cargandoCandidatos, setCargandoCandidatos] = useState(false);
  const [errorCandidatos, setErrorCandidatos] = useState("");
  const [motivoPeriodo, setMotivoPeriodo] = useState("");
  const [comentarioPeriodo, setComentarioPeriodo] = useState("");
  const [enviandoPeriodo, setEnviandoPeriodo] = useState(false);
  const [errorPeriodo, setErrorPeriodo] = useState("");

  // Resultado combinado — mismo bloque visual para AMBOS orígenes (selección de esta página, o período
  // completo): "Generalizar: fecha -> período" (pedido explícito del ticket), un solo estado/una sola sección.
  const [resultadoMasivo, setResultadoMasivo] = useState<ResultadoMasivoUI | null>(null);

  function abrirCierreManual(planId: number) {
    if (expandido !== planId) void abrirDetalle(planId);
    setCierreManualPlanId(planId);
    setMotivoManual("");
    setComentarioManual("");
    setErrorManual("");
  }

  async function confirmarCierreManual(planId: number) {
    const motivo = motivoManual.trim();
    if (motivo.length < 5) {
      setErrorManual("El motivo debe tener al menos 5 caracteres.");
      return;
    }
    setEnviandoManual(true);
    setErrorManual("");
    try {
      const res = await fetch(`/api/empresas/${slug}/tms/planes/${planId}/cerrar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ manual: true, motivo, comentario: comentarioManual.trim() || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorManual(data.error ?? "No se pudo cerrar el viaje.");
        return;
      }
      setCierreManualPlanId(null);
      await cargar();
    } catch {
      setErrorManual("Error de conexión.");
    } finally {
      setEnviandoManual(false);
    }
  }

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

  // PLANES-SEPARAR-CERRADOS — en la pestaña "Viajes cerrados" NUNCA se muestran selección/cierre masivo/cierre
  // por período (ya están cerrados) — plegar `vista === "ACTIVOS"` aquí basta para ocultar TODO lo derivado:
  // columna de checkbox, botones "Seleccionar elegibles"/"Cerrar seleccionados"/"Cierre manual masivo" y las
  // acciones de período (puedeAccionPeriodo, más abajo).
  const mostrarSel = !esReporte && puedeCerrarViaje && vista === "ACTIVOS";

  // Agrupación visual por Día/Semana/Mes SOLO en modo operativo (el reporte conserva la tabla plana).
  const grupos = useMemo(() => (esReporte ? [] : agruparPlanes(planes, modoAgrupacion)), [esReporte, planes, modoAgrupacion]);
  const items = useMemo(() => {
    if (esReporte) return planes.map((p) => ({ kind: "plan" as const, p }));
    const lista: ({ kind: "grupo"; grupo: GrupoPlanes<PlanReporte>; indice: number; abierto: boolean } | { kind: "plan"; p: PlanReporte })[] = [];
    grupos.forEach((grupo, indice) => {
      const abierto = grupoAbierto(indice, grupo.clave, togglesGrupo, planFocoId != null && grupo.planes.some((p) => p.id === planFocoId));
      lista.push({ kind: "grupo", grupo, indice, abierto });
      if (abierto) for (const p of grupo.planes) lista.push({ kind: "plan", p });
    });
    return lista;
  }, [esReporte, planes, grupos, togglesGrupo, planFocoId]);

  function alternarSeleccion(p: PlanReporte) {
    if (!esSeleccionable(p, puedeCerrarViaje)) return;
    setSeleccion((prev) => {
      const n = new Set(prev);
      if (n.has(p.id)) n.delete(p.id); else n.add(p.id);
      return n;
    });
  }

  function seleccionarElegibles(g: GrupoPlanes<PlanReporte>) {
    setSeleccion((prev) => new Set([...prev, ...idsSeleccionables(g.planes, puedeCerrarViaje)]));
  }

  function limpiarSeleccionGrupo(g: GrupoPlanes<PlanReporte>) {
    const ids = new Set(g.planes.map((p) => p.id));
    setSeleccion((prev) => new Set([...prev].filter((id) => !ids.has(id))));
  }

  function abrirMasivo(tipo: "NORMAL" | "MANUAL", clave: string) {
    setMasivo({ tipo, clave });
    setMotivoMasivo("");
    setComentarioMasivo("");
    setErrorMasivo("");
  }

  /** Envía SOLO los elegibles seleccionados EN ESTA PÁGINA; el servidor vuelve a validar todo (permiso, empresa, estado). */
  async function ejecutarMasivo() {
    if (!masivo || enviandoMasivo) return;
    const grupo = grupos.find((g) => g.clave === masivo.clave);
    if (!grupo) return;
    const r = resumenSeleccion(grupo.planes, seleccion, puedeCerrarViaje);
    const ids = masivo.tipo === "NORMAL" ? r.normal.ids : r.manual.ids;
    if (!ids.length) { setErrorMasivo("No hay viajes elegibles seleccionados."); return; }
    const motivo = motivoMasivo.trim();
    if (masivo.tipo === "MANUAL" && (motivo.length < 5 || motivo.length > 500)) {
      setErrorMasivo("El motivo es obligatorio: entre 5 y 500 caracteres.");
      return;
    }
    if (comentarioMasivo.trim().length > 1000) { setErrorMasivo("El comentario no puede superar 1000 caracteres."); return; }
    setEnviandoMasivo(true);
    setErrorMasivo("");
    try {
      const res = await fetch(`/api/empresas/${slug}/tms/planes/cerrar-masivo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(masivo.tipo === "NORMAL"
          ? { tipo: "NORMAL", planIds: ids, grupo: masivo.clave }
          : { tipo: "MANUAL", planIds: ids, grupo: masivo.clave, motivo, comentario: comentarioMasivo.trim() || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setErrorMasivo(data.error ?? "No se pudo ejecutar el cierre masivo."); return; }
      const resultado = data as ResultadoCierreMasivo;
      setResultadoMasivo({ ...resultado, etiquetaOrigen: grupo.etiqueta });
      setMasivo(null);
      await cargar(); // recarga resultados (y limpia la selección)
    } catch {
      setErrorMasivo("Error de conexión.");
    } finally {
      setEnviandoMasivo(false);
    }
  }

  /**
   * PLANES-CIERRE-PERIODO (corrección pre-merge PR #386) — filtros ACTIVOS a respetar por las acciones del
   * período (sección 9 del ticket): cliente/piloto/unidad/estado/ruta/facturación/cobro Y TAMBIÉN
   * soloPendientes/soloCerrados/soloSinCerrar — la acción del período debe representar la INTERSECCIÓN de eso
   * con el rango Día/Semana/Mes (nunca todo el período ignorando el filtro activo). Deliberadamente NO incluye
   * fDesde/fHasta: el período SIEMPRE fija el rango de fechaPlan, nunca las fechas generales de la pantalla.
   * Valores YA TIPADOS (clienteId/pilotoId/unidadId como number) — nunca strings crudos del <select>, para que
   * encajen directo en el cuerpo JSON de cerrar-masivo-periodo (el esquema Zod del backend exige number).
   */
  const filtrosPeriodoValores = useCallback((): FiltrosPeriodoValores => {
    const f: FiltrosPeriodoValores = {};
    if (fCliente) f.clienteId = Number(fCliente);
    if (fPiloto) f.pilotoId = Number(fPiloto);
    if (fUnidad) f.unidadId = Number(fUnidad);
    if (fEstado) f.estado = fEstado;
    if (fRuta.trim()) f.ruta = fRuta.trim();
    if (fEstadoFacturacion) f.estadoFacturacion = fEstadoFacturacion;
    if (fEstadoCobro) f.estadoCobro = fEstadoCobro;
    if (soloPendientes) f.soloPendientesCierre = true;
    if (soloCerrados) f.soloCerrados = true;
    if (soloSinCerrar) f.soloSinCerrar = true;
    return f;
  }, [fCliente, fPiloto, fUnidad, fEstado, fRuta, fEstadoFacturacion, fEstadoCobro, soloPendientes, soloCerrados, soloSinCerrar]);

  /** Abre el modal de cierre DEL PERÍODO y consulta la vista previa (candidatos-cierre) — informativa, nunca ejecuta nada todavía. */
  async function abrirCierrePeriodo(tipo: "NORMAL" | "MANUAL", clave: string) {
    setPeriodoAccion({ tipo, clave });
    setMotivoPeriodo("");
    setComentarioPeriodo("");
    setErrorPeriodo("");
    setCandidatosPeriodo(null);
    setErrorCandidatos("");
    setCargandoCandidatos(true);
    try {
      const fv = filtrosPeriodoValores();
      const qs = new URLSearchParams({ agrupacion: modoAgrupacion, valor: clave });
      if (fv.clienteId != null) qs.set("clienteId", String(fv.clienteId));
      if (fv.pilotoId != null) qs.set("pilotoId", String(fv.pilotoId));
      if (fv.unidadId != null) qs.set("unidadId", String(fv.unidadId));
      if (fv.estado) qs.set("estado", fv.estado);
      if (fv.ruta) qs.set("ruta", fv.ruta);
      if (fv.estadoFacturacion) qs.set("estadoFacturacion", fv.estadoFacturacion);
      if (fv.estadoCobro) qs.set("estadoCobro", fv.estadoCobro);
      if (fv.soloPendientesCierre) qs.set("soloPendientesCierre", "1");
      if (fv.soloCerrados) qs.set("soloCerrados", "1");
      if (fv.soloSinCerrar) qs.set("soloSinCerrar", "1");
      const res = await fetch(`/api/empresas/${slug}/tms/planes/candidatos-cierre?${qs.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setErrorCandidatos(data.error ?? "No se pudo consultar el período."); return; }
      setCandidatosPeriodo(data as CandidatosCierrePeriodo);
    } catch {
      setErrorCandidatos("Error de conexión.");
    } finally {
      setCargandoCandidatos(false);
    }
  }

  /**
   * Confirmar: el backend vuelve a resolver los candidatos DESDE CERO en ese momento (nunca reutiliza los ids
   * de la vista previa de arriba) — si algún viaje cambió de estado mientras el modal estaba abierto, queda
   * omitido con su motivo, nunca se fuerza el cierre (ver cerrarViajesMasivoPorPeriodo en cierre-masivo.ts).
   */
  async function ejecutarCierrePeriodo() {
    if (!periodoAccion || enviandoPeriodo) return;
    const motivo = motivoPeriodo.trim();
    if (periodoAccion.tipo === "MANUAL" && (motivo.length < 5 || motivo.length > 500)) {
      setErrorPeriodo("El motivo es obligatorio: entre 5 y 500 caracteres.");
      return;
    }
    if (comentarioPeriodo.trim().length > 1000) { setErrorPeriodo("El comentario no puede superar 1000 caracteres."); return; }
    setEnviandoPeriodo(true);
    setErrorPeriodo("");
    try {
      const filtros = filtrosPeriodoValores();
      const res = await fetch(`/api/empresas/${slug}/tms/planes/cerrar-masivo-periodo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(periodoAccion.tipo === "NORMAL"
          ? { agrupacion: modoAgrupacion, valor: periodoAccion.clave, tipo: "NORMAL", filtros }
          : { agrupacion: modoAgrupacion, valor: periodoAccion.clave, tipo: "MANUAL", filtros, motivo, comentario: comentarioPeriodo.trim() || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setErrorPeriodo(data.error ?? "No se pudo ejecutar el cierre del período."); return; }
      const resultado = data as ResultadoCierreMasivoPeriodo;
      setResultadoMasivo({ ...resultado, etiquetaOrigen: resultado.etiqueta });
      setPeriodoAccion(null);
      await cargar();
    } catch {
      setErrorPeriodo("Error de conexión.");
    } finally {
      setEnviandoPeriodo(false);
    }
  }

  /** "Cerrar elegibles del período"/"Cierre manual del período": deshabilitado con deep-link (?plan=) activo o en modo reporte. */
  const puedeAccionPeriodo = mostrarSel && planFocoId == null;

  const columnas = [
    ...(mostrarSel ? ["Sel."] : []),
    "Código", "Fecha", "Cliente", "Ruta", "Placa", "Piloto", "Auxiliares",
    "H. salida", "H. llegada", "Km salida", "Km llegada", "Km rec.",
    "Evid.", "Tarifa usada", "Tarifa", "Estado",
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
        <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">{esReporte ? "Operaciones · Reportes" : "Operaciones"}</p>
        <h1 className="mt-1 text-2xl font-semibold text-[var(--text)]">{esReporte ? "Reporte de viajes / historial" : "Planes / Viajes"}</h1>
        {esReporte ? (
          <p className="text-sm text-[var(--muted)]">
            Vista de consulta y análisis: indicadores, facturación agregada e histórico exportable (Excel / PDF) sobre el filtro aplicado. La tabla es de solo consulta — para cerrar un viaje o ver su expediente operativo usa{" "}
            <Link href={`/e/${slug}/planes`} className={linkCls}>Operaciones → Planes / Viajes</Link>.
          </p>
        ) : (
          <p className="text-sm text-[var(--muted)]">
            Gestión de viajes existentes: estados, expediente y cierre. Para indicadores, facturación agregada y exportaciones usa{" "}
            <Link href={`/e/${slug}/reportes/viajes`} className={linkCls}>Reportes → Reporte de viajes / historial</Link>. Para crear o reprogramar un viaje usa{" "}
            <Link href={`/e/${slug}/programacion`} className={linkCls}>Programación</Link>.
          </p>
        )}
      </div>

      {bannerCierre ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-700/60 bg-emerald-950/20 px-3 py-2 text-sm text-emerald-300">
          <span>Plan cerrado correctamente.</span>
          <button type="button" className="text-xs underline" onClick={() => setBannerCierre(false)}>Ocultar</button>
        </div>
      ) : null}

      {planFocoId != null ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm text-[var(--text)]">
          <span>Mostrando solo el plan enfocado (#{planFocoId}).</span>
          <button type="button" className={`text-xs ${linkCls}`} onClick={verTodosLosPlanes}>Ver todos los planes</button>
        </div>
      ) : null}

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
            {/* PLANES-SEPARAR-CERRADOS — en ACTIVOS (operativo) "Cerrado" no se ofrece (combinación imposible
                con soloSinCerrar); en CERRADOS queda fijo en "Cerrado" y deshabilitado (la pestaña ya lo fija).
                Modo reporte: sin cambios, todas las opciones de siempre. */}
            <select
              className={`${inputCls} mt-0.5 block`}
              value={fEstado}
              onChange={(e) => setFEstado(e.target.value)}
              disabled={!esReporte && vista === "CERRADOS"}
            >
              {!esReporte && vista === "CERRADOS" ? (
                <option value="Cerrado">Cerrado</option>
              ) : (
                <>
                  <option value="">Todos</option>
                  {(esReporte ? ESTADOS : ESTADOS.filter((e) => e !== "Cerrado")).map((e) => <option key={e} value={e}>{e}</option>)}
                </>
              )}
            </select>
          </label>
          {/* PROGRAMACION-REPORTES-FILTROS-1 — texto libre: código de ruta o destino (ej. "Xela"). */}
          <label className="text-xs text-[var(--muted)]">Ruta
            <input
              className={`${inputCls} mt-0.5 block`}
              placeholder="Código o destino"
              value={fRuta}
              onChange={(e) => setFRuta(e.target.value)}
            />
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
          {/* PLANES-SEPARAR-CERRADOS — "Solo pendientes de cierre" vive en AMBOS modos, pero en operativo solo
              tiene sentido dentro de la pestaña ACTIVOS (en CERRADOS no aplica: todo ya está Cerrado). */}
          {esReporte || vista === "ACTIVOS" ? (
            <label className="flex items-center gap-1 text-[var(--text)]">
              <input
                type="checkbox"
                checked={soloPendientes}
                onChange={(e) => {
                  setSoloPendientes(e.target.checked);
                  // Modo reporte: se conserva la exclusión mutua de siempre entre los 3 checkboxes. Modo
                  // operativo: soloSinCerrar ya lo controla la pestaña, nunca lo toca este checkbox.
                  if (esReporte && e.target.checked) { setSoloCerrados(false); setSoloSinCerrar(false); }
                }}
              />
              Solo pendientes de cierre
            </label>
          ) : null}
          {/* PLANES-SEPARAR-CERRADOS — "Solo cerrados"/"Solo sin cerrar" se QUITAN de la interfaz en modo
              operativo (esa función ahora la cumplen las pestañas) pero se CONSERVAN en modo reporte, sin
              cambios, para el análisis flexible que Reportes necesita. */}
          {esReporte ? (
            <>
              <label className="flex items-center gap-1 text-[var(--text)]">
                <input type="checkbox" checked={soloCerrados} onChange={(e) => { setSoloCerrados(e.target.checked); if (e.target.checked) setSoloSinCerrar(false); }} />
                Solo cerrados
              </label>
              <label className="flex items-center gap-1 text-[var(--text)]">
                <input type="checkbox" checked={soloSinCerrar} onChange={(e) => { setSoloSinCerrar(e.target.checked); if (e.target.checked) setSoloCerrados(false); }} />
                Solo sin cerrar
              </label>
            </>
          ) : null}
        </div>
        {/* OPERACIONES-UX-PLANES-REPORTES-1 — exportación solo en la vista
            de Reportes (Reportes = análisis + exportaciones). */}
        {esReporte ? (
          <div className="mt-2 flex flex-wrap gap-2">
            <a className="rounded bg-[#334155] px-3 py-1.5 text-xs text-white" href={`/api/empresas/${slug}/tms/reportes/viajes/export?formato=xlsx&${exportQueryString()}`}>Exportar Excel (todo el filtro)</a>
            <a className="rounded bg-[#334155] px-3 py-1.5 text-xs text-white" href={`/api/empresas/${slug}/tms/reportes/viajes/export?formato=pdf&${exportQueryString()}`}>Exportar PDF (todo el filtro)</a>
          </div>
        ) : null}
      </section>

      {/* PLANES-SEPARAR-CERRADOS — pestañas principales, SOLO modo operativo (Reportes conserva su vista de
          siempre). Es exclusivamente un filtro de estado (soloSinCerrar/soloCerrados, ya existentes en el
          backend) — nunca una tabla nueva ni datos movidos. Default: "Pendientes / Activos". */}
      {!esReporte ? (
        <div className="inline-flex overflow-hidden rounded-lg border border-[var(--border)] text-sm" role="tablist" aria-label="Vista de viajes">
          <button
            type="button"
            role="tab"
            aria-selected={vista === "ACTIVOS"}
            className={`px-4 py-2 font-medium transition ${vista === "ACTIVOS" ? "bg-[var(--accent)] text-white" : "text-[var(--text)] hover:bg-[var(--input)]"}`}
            onClick={() => irAVista("ACTIVOS")}
          >
            Pendientes / Activos
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={vista === "CERRADOS"}
            className={`border-l border-[var(--border)] px-4 py-2 font-medium transition ${vista === "CERRADOS" ? "bg-[var(--accent)] text-white" : "text-[var(--text)] hover:bg-[var(--input)]"}`}
            onClick={() => irAVista("CERRADOS")}
          >
            Viajes cerrados
          </button>
        </div>
      ) : null}

      {/* KPI — OPERACIONES-UX-PLANES-REPORTES-1: los indicadores y el bloque
          de facturación viven en la vista de Reportes, no en la gestión
          operativa de Planes / Viajes. */}
      {esReporte && kpi ? (
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
      {esReporte && kpi ? (
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

      {resultadoMasivo ? (
        <section aria-label="Resultado del cierre masivo" className="space-y-1 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm text-[var(--text)]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <strong>Cierre masivo {resultadoMasivo.tipo === "MANUAL" ? "manual" : "normal"} — {resultadoMasivo.etiquetaOrigen}</strong>
            <button type="button" className="text-xs underline" onClick={() => setResultadoMasivo(null)}>Ocultar</button>
          </div>
          <p>Cerrados: {resultadoMasivo.cerrados.length} · Omitidos: {resultadoMasivo.omitidos.length} · Errores: {resultadoMasivo.errores.length}</p>
          {resultadoMasivo.cerrados.length ? <p className="text-xs text-emerald-400">Cerrados: {resultadoMasivo.cerrados.map((c) => c.codigo).join(", ")}</p> : null}
          {resultadoMasivo.omitidos.length ? (
            <ul className="list-disc pl-5 text-xs text-amber-300">{resultadoMasivo.omitidos.map((o) => <li key={`o${o.id}`}>{o.codigo}: {o.motivo}</li>)}</ul>
          ) : null}
          {resultadoMasivo.errores.length ? (
            <ul className="list-disc pl-5 text-xs text-rose-400">{resultadoMasivo.errores.map((o) => <li key={`e${o.id}`}>{o.codigo}: {o.motivo}</li>)}</ul>
          ) : null}
        </section>
      ) : null}

      {/* PLANES-CIERRE-PERIODO — selector de agrupación Día/Semana/Mes, solo en modo operativo (el reporte
          conserva la tabla plana, sin agrupación ni acciones). Default DÍA. */}
      {!esReporte ? (
        <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
          <label className="flex items-center gap-1.5">
            Agrupar por
            <select
              className={`${inputCls} py-1`}
              value={modoAgrupacion}
              onChange={(e) => setModoAgrupacion(e.target.value as AgrupacionPlanes)}
            >
              <option value="DIA">Día</option>
              <option value="SEMANA">Semana</option>
              <option value="MES">Mes</option>
            </select>
          </label>
        </div>
      ) : null}

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
            {items.map((it) => {
              if (it.kind === "grupo") {
                const g = it.grupo;
                const nota = notaPaginacionGrupo(it.indice, grupos.length, page, totalPaginas, modoAgrupacion);
                const parcial = nota != null;
                const r = resumenSeleccion(g.planes, seleccion, puedeCerrarViaje);
                return (
                  <tr key={`grupo-${g.clave}`} data-grupo-clave={g.clave} className="border-t-2 border-[var(--border)] bg-[var(--thead)]">
                    <td colSpan={columnas.length} className="px-3 py-2">
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                        <button
                          type="button"
                          aria-expanded={it.abierto}
                          className="text-sm font-semibold text-[var(--text)]"
                          onClick={() => setTogglesGrupo((t) => ({ ...t, [g.clave]: !it.abierto }))}
                        >
                          {it.abierto ? "▼" : "▶"} {g.etiqueta}
                        </button>
                        {modoAgrupacion === "DIA" && g.clave === hoy ? <span className="rounded-full bg-sky-600 px-2 py-0.5 text-[10px] font-medium text-white">Hoy</span> : null}
                        {/* PLANES-SEPARAR-CERRADOS — en la pestaña CERRADOS el grupo es 100% cerrados por
                            filtro: un contador único y limpio en vez de repetir "0 pendientes de cierre · 0
                            otros" sin sentido. En ACTIVOS se mantienen los contadores de siempre (ocultando
                            "0 cerrados", que el filtro de la pestaña ya garantiza en 0). No se tocó el helper
                            de conteos (agruparPlanes) — mismo GrupoPlanes de siempre, solo cambia qué se pinta. */}
                        {!esReporte && vista === "CERRADOS" ? (
                          <span className="text-xs text-emerald-500">{g.total} viaje(s) · {g.cerrados} cerrados</span>
                        ) : (
                          <>
                            <span className="text-xs text-[var(--text)]">{g.total} viaje(s){parcial ? " en esta página" : ""}</span>
                            <span className="text-xs text-amber-500">{g.cerrables} pendientes de cierre</span>
                            {g.cerrados > 0 ? <span className="text-xs text-emerald-500">{g.cerrados} cerrados</span> : null}
                            <span className="text-xs text-[var(--muted)]">{g.otros} otros</span>
                          </>
                        )}
                        {nota ? <span className="text-xs italic text-[var(--muted)]">{nota}</span> : null}
                      </div>
                      {mostrarSel && it.abierto ? (
                        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
                          <button type="button" className={linkCls} disabled={!idsSeleccionables(g.planes, puedeCerrarViaje).length} onClick={() => seleccionarElegibles(g)}>Seleccionar elegibles</button>
                          <button type="button" className={linkCls} disabled={!r.seleccionados} onClick={() => limpiarSeleccionGrupo(g)}>Limpiar selección</button>
                          <button type="button" className="rounded bg-emerald-600 px-2.5 py-1 font-medium text-white disabled:opacity-40" disabled={!r.normal.elegibles} onClick={() => abrirMasivo("NORMAL", g.clave)}>
                            Cerrar seleccionados{r.seleccionados ? ` (Elegibles ${r.normal.elegibles} / No elegibles ${r.normal.noElegibles})` : ""}
                          </button>
                          <button type="button" className="rounded bg-rose-600 px-2.5 py-1 font-medium text-white disabled:opacity-40" disabled={!r.manual.elegibles} onClick={() => abrirMasivo("MANUAL", g.clave)}>
                            Cierre manual masivo{r.seleccionados ? ` (Elegibles ${r.manual.elegibles} / No elegibles ${r.manual.noElegibles})` : ""}
                          </button>
                        </div>
                      ) : null}
                      {/* PLANES-CIERRE-PERIODO — acción DEL PERÍODO COMPLETO, nunca de "lo seleccionado en esta página":
                          resuelve TODO el Día/Semana/Mes server-side, incluyendo viajes de otras páginas. */}
                      {puedeAccionPeriodo && it.abierto ? (
                        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
                          <span className="text-[var(--muted)]">Período completo:</span>
                          <button type="button" className="rounded border border-emerald-600 px-2.5 py-1 font-medium text-emerald-500" onClick={() => void abrirCierrePeriodo("NORMAL", g.clave)}>
                            Cerrar elegibles del período
                          </button>
                          <button type="button" className="rounded border border-rose-600 px-2.5 py-1 font-medium text-rose-500" onClick={() => void abrirCierrePeriodo("MANUAL", g.clave)}>
                            Cierre manual del período
                          </button>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                );
              }
              const p = it.p;
              const badge = badgeEstado(p);
              const acc = accionesViaje(modo, p, puedeCerrarViaje);
              return (
                <Fragment key={p.id}>
                  <tr className="border-t border-[var(--border)] bg-[var(--card)] align-top">
                    {mostrarSel ? (
                      <td className="px-2 py-1.5 text-xs">
                        <input
                          type="checkbox"
                          aria-label={`Seleccionar ${p.codigo}`}
                          checked={seleccion.has(p.id)}
                          disabled={!esSeleccionable(p, puedeCerrarViaje)}
                          onChange={() => alternarSeleccion(p)}
                        />
                      </td>
                    ) : null}
                    <td className="px-2 py-1.5 font-mono text-xs">{p.codigo}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-xs">{p.fechaPlan}</td>
                    <td className="px-2 py-1.5 text-xs">{p.cliente ?? "—"}</td>
                    <td className="px-2 py-1.5 text-xs">{p.rutaCodigo ?? "—"}</td>
                    <td className="px-2 py-1.5 text-xs">
                      {p.placa ?? "—"}
                      {p.tcPlaca ? (
                        <span className="block text-[10px] text-[var(--muted)]" title={`${ETIQUETA_TC} (${etiquetaOrigenTc(p.tcOrigen)})`}>TC: {p.tcPlaca}</span>
                      ) : null}
                    </td>
                    <td className="px-2 py-1.5 text-xs"><PilotosCelda principal={p.piloto} extra={p.pilotoExtra} /></td>
                    <td className="px-2 py-1.5 text-xs">{p.auxiliares.join(", ") || "—"}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-xs">{formatearFechaHora12(p.horaSalida)}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-xs">{formatearFechaHora12(p.horaLlegada)}</td>
                    <td className="px-2 py-1.5 text-xs">{p.kmSalida ?? "—"}</td>
                    <td className="px-2 py-1.5 text-xs">{p.kmLlegada ?? "—"}</td>
                    <td className="px-2 py-1.5 text-xs">{p.kmRecorridos ?? "—"}</td>
                    <td className="px-2 py-1.5 text-xs">{p.evidencias}</td>
                    <td className="px-2 py-1.5 text-xs" title={p.tarifaMontoSnapshot != null ? `Monto de la tarifa al armar el viaje: ${moneda(p.tarifaMontoSnapshot)}` : undefined}>{p.tarifaNombre ?? "—"}</td>
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
                        <button type="button" className={linkCls} onClick={() => void abrirDetalle(p.id)}>
                          {expandido === p.id ? "Cerrar" : esExpedienteHistorico(p.estado) ? "Ver expediente" : "Ver detalle"}
                        </button>
                        {acc.irProgramacion ? (
                          <Link href={`/e/${slug}/programacion?plan=${p.id}`} className={linkCls}>Programación</Link>
                        ) : null}
                        {acc.pdf ? (
                          <a className={linkCls} href={`/api/empresas/${slug}/tms/planes/${p.id}/reporte-pdf`}>PDF</a>
                        ) : null}
                        {acc.cerrar ? (
                          <button type="button" className="text-emerald-500 hover:underline" onClick={() => pedirCierre(p.id)}>
                            Cerrar viaje
                          </button>
                        ) : null}
                        {acc.cierreManual ? (
                          <button type="button" className="text-rose-500 hover:underline" onClick={() => abrirCierreManual(p.id)}>
                            Cierre manual
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
                              <li>
                                Tarifa usada: {p.tarifaNombre ?? "—"}
                                {p.tarifaMontoSnapshot != null
                                  ? ` · ${p.tarifaMoneda ?? "GTQ"} ${p.tarifaMontoSnapshot.toLocaleString("es-GT", { minimumFractionDigits: 2 })} (snapshot)`
                                  : ""}
                              </li>
                              <li>Monto del viaje (ingresos): {moneda(p.tarifaComercial)}</li>
                              <li>Estado: {p.estado}</li>
                            </ul>
                            <p className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">B. Personal / unidad</p>
                            <ul className="mt-1 space-y-0.5 text-xs text-[var(--text)]">
                              <li>{p.pilotoExtra ? "Pilotos" : "Piloto"}: {textoPilotos(p.piloto, p.pilotoExtra) || "—"}</li>
                              <li>Auxiliares: {p.auxiliares.join(", ") || "—"}</li>
                              <li>Unidad: {p.placa ?? "—"}</li>
                              <li>Equipo asignado: {p.unidadTipo ? `${p.unidadTipo}${p.unidadCapacidad ? ` · ${p.unidadCapacidad}` : ""}` : "—"}</li>
                              <li>{ETIQUETA_TC}: {p.tcPlaca ?? "—"}</li>
                              {p.tcPlaca ? <li>Origen del TC: {etiquetaOrigenTc(p.tcOrigen)}</li> : null}
                            </ul>
                          </div>
                          <div>
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">C. Operación</p>
                            <ul className="mt-1 space-y-0.5 text-xs text-[var(--text)]">
                              <li>Hora programada: {formatearHora12(p.horaCarga)}</li>
                              <li>Hora salida real: {formatearFechaHora12(p.horaSalida)}</li>
                              <li>Hora llegada real: {formatearFechaHora12(p.horaLlegada)}</li>
                              <li>Km salida: {p.kmSalida ?? "—"}</li>
                              <li>Km llegada: {p.kmLlegada ?? "—"}</li>
                              <li>Km recorridos: {p.kmRecorridos ?? "—"}</li>
                              <li>Días de ruta: {p.diasRuta ?? "—"}</li>
                              {(() => {
                                const regreso = resumenRegreso(
                                  { estado: p.estado, regresoEstimado: p.regresoEstimado, regresoReal: p.regresoReal ?? p.horaLlegada ?? null, cerradoEn: p.cerradoEn, cierreManual: p.cierreManual },
                                  fh,
                                );
                                return (
                                  <>
                                    <li>Regreso estimado: {regreso.estimado}</li>
                                    {regreso.real ? <li>Regreso real: {regreso.real}</li> : null}
                                    {regreso.cierreAdministrativo ? <li>Cierre administrativo: {regreso.cierreAdministrativo}</li> : null}
                                    {regreso.notaCierreManual ? <li className="text-rose-500">{regreso.notaCierreManual}</li> : null}
                                  </>
                                );
                              })()}
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
                            {acc.faltaTarifa ? (
                              <p className="mt-2 text-[11px] text-amber-500" title="Asigná una tarifa antes de cerrar este viaje.">
                                Falta tarifa — asigná una tarifa antes de cerrar este viaje.
                              </p>
                            ) : null}
                            {acc.cerrar ? (
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
                            {acc.cierreManual ? (
                              cierreManualPlanId === p.id ? (
                                <div className="mt-2 space-y-1.5 rounded border-2 border-rose-600 bg-rose-950/20 p-2 text-xs">
                                  <p className="font-semibold uppercase tracking-wide text-rose-500">⚠ Cierre manual por Operaciones</p>
                                  <p className="text-[11px] text-[var(--text)]">
                                    Este cierre permite finalizar administrativamente el plan aunque el
                                    piloto no haya completado el flujo normal. No crea evidencias,
                                    ubicaciones ni kilometrajes inexistentes.
                                  </p>
                                  <label className="block text-[11px] text-[var(--text)]">
                                    Motivo (obligatorio)
                                    <textarea
                                      className="mt-1 block w-full rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1 text-xs"
                                      rows={2}
                                      maxLength={500}
                                      value={motivoManual}
                                      onChange={(e) => setMotivoManual(e.target.value)}
                                    />
                                  </label>
                                  <label className="block text-[11px] text-[var(--text)]">
                                    Comentario adicional (opcional)
                                    <textarea
                                      className="mt-1 block w-full rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1 text-xs"
                                      rows={2}
                                      maxLength={1000}
                                      value={comentarioManual}
                                      onChange={(e) => setComentarioManual(e.target.value)}
                                    />
                                  </label>
                                  {errorManual ? <p className="text-rose-500">{errorManual}</p> : null}
                                  <div className="flex gap-2 pt-1">
                                    <button type="button" className="rounded bg-rose-700 px-2.5 py-1 font-medium text-white disabled:opacity-50" disabled={enviandoManual} onClick={() => void confirmarCierreManual(p.id)}>
                                      {enviandoManual ? "Cerrando…" : "Confirmar cierre manual"}
                                    </button>
                                    <button type="button" className="rounded border border-[var(--border)] px-2.5 py-1 text-[var(--text)]" disabled={enviandoManual} onClick={() => setCierreManualPlanId(null)}>
                                      Cancelar
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <button type="button" className="mt-2 rounded border border-rose-600 px-2.5 py-1 text-xs font-medium text-rose-500" onClick={() => abrirCierreManual(p.id)}>
                                  Cierre manual
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

      {masivo ? (() => {
        const grupo = grupos.find((g) => g.clave === masivo.clave);
        const r = grupo ? resumenSeleccion(grupo.planes, seleccion, puedeCerrarViaje) : null;
        if (!r || !grupo) return null;
        const manual = masivo.tipo === "MANUAL";
        const cual = manual ? r.manual : r.normal;
        return (
          <div role="dialog" aria-modal="true" aria-label={manual ? "Cierre manual masivo" : "Cierre masivo"} className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
            <div className="w-full max-w-lg space-y-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 text-sm text-[var(--text)]">
              <h2 className="text-base font-semibold">{manual ? "Cierre manual masivo" : "Cierre masivo"} — {grupo.etiqueta}</h2>
              <div>
                <p>Seleccionados: {r.seleccionados}</p>
                <p>{manual ? "Elegibles para cierre manual" : "Elegibles"}: {cual.elegibles}</p>
                <p>No elegibles: {cual.noElegibles}</p>
              </div>
              {manual ? (
                <>
                  <p className="rounded border border-amber-700/60 bg-amber-950/20 px-2 py-1.5 text-xs text-amber-300">
                    Este cierre es administrativo y puede cerrar viajes sin llegada física registrada. No se crearán horas de llegada, km de llegada ni evidencias.
                  </p>
                  <label className="block text-xs text-[var(--muted)]">Motivo *
                    <textarea className={`${inputCls} mt-0.5 block w-full`} rows={2} maxLength={500} value={motivoMasivo} onChange={(e) => setMotivoMasivo(e.target.value)} />
                  </label>
                  <label className="block text-xs text-[var(--muted)]">Comentario (opcional)
                    <textarea className={`${inputCls} mt-0.5 block w-full`} rows={2} maxLength={1000} value={comentarioMasivo} onChange={(e) => setComentarioMasivo(e.target.value)} />
                  </label>
                </>
              ) : null}
              <p>Se intentarán cerrar únicamente los {cual.elegibles} elegibles. ¿Continuar?</p>
              {errorMasivo ? <p role="alert" className="text-xs text-rose-500">{errorMasivo}</p> : null}
              <div className="flex justify-end gap-2">
                <button type="button" className="rounded border border-[var(--border)] px-3 py-1.5 text-xs" disabled={enviandoMasivo} onClick={() => setMasivo(null)}>Cancelar</button>
                <button
                  type="button"
                  className={`rounded px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40 ${manual ? "bg-rose-600" : "bg-emerald-600"}`}
                  disabled={enviandoMasivo || !cual.elegibles || (manual && motivoMasivo.trim().length < 5)}
                  onClick={() => void ejecutarMasivo()}
                >
                  {enviandoMasivo ? "Cerrando…" : manual ? "Confirmar cierre manual" : "Confirmar cierre"}
                </button>
              </div>
            </div>
          </div>
        );
      })() : null}

      {/* PLANES-CIERRE-PERIODO — modal de confirmación del cierre DEL PERÍODO COMPLETO. Nunca ejecuta nada al
          abrir: candidatosPeriodo es solo una VISTA PREVIA informativa (GET candidatos-cierre); el POST de
          confirmación (ejecutarCierrePeriodo) vuelve a resolver los candidatos desde cero en el servidor. */}
      {periodoAccion ? (() => {
        const manual = periodoAccion.tipo === "MANUAL";
        const cual = candidatosPeriodo ? (manual ? candidatosPeriodo.manual : candidatosPeriodo.normal) : null;
        const noElegibles = candidatosPeriodo && cual ? candidatosPeriodo.total - cual.elegibles : null;
        const etiquetaPeriodo = candidatosPeriodo?.periodo.etiqueta
          ?? grupos.find((g) => g.clave === periodoAccion.clave)?.etiqueta
          ?? periodoAccion.clave;
        const nombrePeriodo = modoAgrupacion === "DIA" ? "este día" : modoAgrupacion === "SEMANA" ? "esta semana" : "este mes";
        return (
          <div role="dialog" aria-modal="true" aria-label={manual ? "Cierre manual del período" : "Cierre del período completo"} className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
            <div className="w-full max-w-lg space-y-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 text-sm text-[var(--text)]">
              <h2 className="text-base font-semibold">{manual ? "Cierre manual del período" : "Cierre del período completo"} — {etiquetaPeriodo}</h2>
              <p className="rounded border border-sky-700/60 bg-sky-950/20 px-2 py-1.5 text-xs text-sky-300">
                Vas a intentar cerrar todos los viajes elegibles de {nombrePeriodo} que coincidan con los filtros actuales,
                incluyendo viajes de otras páginas. Esta operación NO depende de lo que está seleccionado ni de lo que se ve en esta página.
              </p>
              {cargandoCandidatos ? <p className="text-xs text-[var(--muted)]">Consultando el período…</p> : null}
              {errorCandidatos ? <p role="alert" className="text-xs text-rose-500">{errorCandidatos}</p> : null}
              {candidatosPeriodo && cual ? (
                <div>
                  <p>Viajes encontrados: {candidatosPeriodo.total}</p>
                  <p>{manual ? "Elegibles para cierre manual" : "Elegibles para cierre normal"}: {cual.elegibles}</p>
                  <p>No elegibles: {noElegibles}</p>
                </div>
              ) : null}
              {manual ? (
                <>
                  <p className="rounded border border-amber-700/60 bg-amber-950/20 px-2 py-1.5 text-xs text-amber-300">
                    Este cierre es administrativo y puede cerrar viajes sin llegada física registrada. No se crearán horas de llegada, km de llegada ni evidencias.
                  </p>
                  <label className="block text-xs text-[var(--muted)]">Motivo *
                    <textarea className={`${inputCls} mt-0.5 block w-full`} rows={2} maxLength={500} value={motivoPeriodo} onChange={(e) => setMotivoPeriodo(e.target.value)} />
                  </label>
                  <label className="block text-xs text-[var(--muted)]">Comentario (opcional)
                    <textarea className={`${inputCls} mt-0.5 block w-full`} rows={2} maxLength={1000} value={comentarioPeriodo} onChange={(e) => setComentarioPeriodo(e.target.value)} />
                  </label>
                </>
              ) : null}
              {errorPeriodo ? <p role="alert" className="text-xs text-rose-500">{errorPeriodo}</p> : null}
              <div className="flex justify-end gap-2">
                <button type="button" className="rounded border border-[var(--border)] px-3 py-1.5 text-xs" disabled={enviandoPeriodo} onClick={() => setPeriodoAccion(null)}>Cancelar</button>
                <button
                  type="button"
                  className={`rounded px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40 ${manual ? "bg-rose-600" : "bg-emerald-600"}`}
                  disabled={enviandoPeriodo || cargandoCandidatos || !cual || !cual.elegibles || (manual && motivoPeriodo.trim().length < 5)}
                  onClick={() => void ejecutarCierrePeriodo()}
                >
                  {enviandoPeriodo ? "Cerrando…" : cual ? `Confirmar cierre de ${cual.elegibles} viajes` : manual ? "Confirmar cierre manual" : "Confirmar cierre"}
                </button>
              </div>
            </div>
          </div>
        );
      })() : null}
    </div>
  );
}
