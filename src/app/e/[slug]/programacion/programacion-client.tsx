"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  DisponibilidadPersonal,
  EstadoDisponibilidad,
} from "@/lib/operaciones/disponibilidad-personal";
import PlanForm from "./plan-form";

/**
 * Operaciones → Programación — pantalla operativa principal para crear y
 * gestionar viajes (antes Fase P3, solo lectura).
 *
 * Consume tal cual GET /api/empresas/[slug]/tms/planes (el mismo endpoint
 * que ya usa la pantalla TMS existente). El tablero/resumen/filtros siguen
 * siendo de solo lectura y se calculan en el cliente a partir de lo que el
 * GET ya entrega; la creación/edición real vive en ./plan-form.tsx (mismos
 * endpoints POST/PATCH que ya usaba TMS, sin modelo ni tabla nuevos).
 *
 * Fase P4.2: además consume GET /api/empresas/[slug]/operaciones/
 * disponibilidad-personal?fecha=YYYY-MM-DD (envuelve listarDisponibilidadPersonal,
 * que sí vive en servidor — nunca se importa esa lib aquí).
 *
 * Fase P4.3: el cruce plan↔persona es por personalId (pilotoId /
 * auxiliaresDetalle[].personalId), IDs reales que el GET de planes ya
 * expone de forma aditiva. Ya NO se cruza por nombre — si un plan legado no
 * trae un id válido, se muestra el nombre sin badge de disponibilidad
 * ("Sin información de disponibilidad"), nunca se asocia por coincidencia
 * de texto con otra persona.
 */

/** Solo `import type` — tipos, no código; no arrastra mysql2 al bundle del cliente. */
type AdvertenciaPersonal = DisponibilidadPersonal["advertencias"][number];

type ParadaPlan = {
  id: number;
  orden: number;
  lugar_nombre: string;
  tipo: string;
  requiere_evidencia: boolean;
  evidencias: number;
};

/** Auxiliar de un plan con su id real de tms_personal (Fase P4.3). */
type AuxiliarPlan = { personalId: number; nombre: string };

export type Plan = {
  id: number;
  codigo: string;
  fecha_plan: string;
  hora_carga: string | null;
  estado: string;
  tipo_traslado: string | null;
  regreso_estimado: string | null;
  tarifa_comercial: number | null;
  referencia_cliente: string | null;
  notas: string | null;
  cliente: string | null;
  placa: string | null;
  piloto: string | null;
  auxiliar: string | null;
  auxiliares: string[];
  /** Aditivo (Fase P4.3): id real del piloto, cuando el plan lo tiene. */
  pilotoId: number | null;
  /** Aditivo (Fase P4.3): auxiliares con su personal_id real. */
  auxiliaresDetalle: AuxiliarPlan[];
  paradas: ParadaPlan[];
  paradasPendientes: number;
  evidencias: number;
};

/** Estado real por placa (Ajuste 2) — mismos valores que EstadoDisponibilidad
 * de src/lib/operaciones/disponibilidad.ts, expuestos ahora por el GET. */
type EstadoVehiculo = {
  placa: string;
  estadoDisponibilidad: "disponible" | "en_taller" | "en_ruta" | "inactivo";
  motivoNoDisponible: string | null;
};

type Rango = "hoy" | "manana" | "semana";

const ESTADO_LABEL: Record<string, string> = {
  Programado: "Programado",
  "En ruta": "En ruta",
  Descargado: "Finalizado", // Fase A: mismo valor interno, solo cambia la etiqueta visible.
};

// Mismas etiquetas/colores que ya usa Disponibilidad flota
// (src/components/operaciones/disponibilidad-client.tsx), para consistencia
// visual entre las dos pantallas de Operaciones.
const ESTADO_VEHICULO_LABEL: Record<EstadoVehiculo["estadoDisponibilidad"], string> = {
  disponible: "Disponible",
  en_taller: "En taller",
  en_ruta: "En ruta",
  inactivo: "Inactiva",
};

const ESTADO_VEHICULO_BADGE: Record<EstadoVehiculo["estadoDisponibilidad"], string> = {
  disponible: "bg-emerald-900/50 text-emerald-200",
  en_taller: "bg-amber-900/50 text-amber-200",
  en_ruta: "bg-sky-900/50 text-sky-200",
  inactivo: "bg-rose-900/40 text-rose-200",
};

const ESTADO_BADGE: Record<string, string> = {
  Programado: "bg-sky-900/50 text-sky-200",
  "En ruta": "bg-amber-900/50 text-amber-200",
  Descargado: "bg-emerald-900/50 text-emerald-200",
};

function normPlaca(p: string): string {
  return p.toUpperCase().replace(/[\s-]/g, "");
}

const ESTADO_PERSONA_ICONO: Record<EstadoDisponibilidad, string> = {
  disponible: "🟢",
  no_disponible: "🔴",
  verificacion_parcial: "🟡",
};

const ESTADO_PERSONA_LABEL: Record<EstadoDisponibilidad, string> = {
  disponible: "Disponible",
  no_disponible: "No disponible",
  verificacion_parcial: "Verificación parcial",
};

/**
 * Badge compacto de disponibilidad para un piloto/auxiliar de un plan.
 * Cruce EXCLUSIVAMENTE por personalId (Fase P4.3) — nunca por nombre. Si el
 * plan no trae un id válido (dato legado) o no hay disponibilidad cargada
 * todavía para esa fecha, se muestra el nombre con un aviso neutral, nunca
 * se adivina el estado de otra persona por coincidencia de texto.
 */
function PersonaEstado({
  nombre,
  disp,
  tieneId,
  planIdActual,
}: {
  nombre: string;
  disp: DisponibilidadPersonal | undefined;
  /** false = el plan no trae personalId para esta persona (dato legado). */
  tieneId: boolean;
  planIdActual: number;
}) {
  if (!disp) {
    return (
      <span className="flex flex-wrap items-center gap-1 text-[12px]">
        <span>{nombre}</span>
        {!tieneId ? (
          <span
            className="rounded bg-[var(--input)] px-1 py-0.5 text-[10px] text-[var(--muted)]"
            title="Este plan no tiene un id de personal vinculado (dato legado) — no se puede verificar disponibilidad sin adivinar por nombre."
          >
            Sin información de disponibilidad
          </span>
        ) : null}
      </span>
    );
  }

  const enRutaAhora =
    disp.estadoDisponibilidad === "no_disponible" && disp.viajeActual != null;
  const porIncidencia =
    disp.estadoDisponibilidad === "no_disponible" &&
    !enRutaAhora &&
    disp.incidenciasBloqueantes.length > 0;
  const sinVinculo = disp.advertencias.some((a) => a.tipo === "sin_vinculo_empleado");

  let detalle = "";
  let etiqueta = ESTADO_PERSONA_LABEL[disp.estadoDisponibilidad];
  if (enRutaAhora && disp.viajeActual) {
    etiqueta = "En ruta actualmente";
    detalle = [
      disp.viajeActual.placa ? `Unidad ${disp.viajeActual.placa}` : null,
      `Salida real ${disp.viajeActual.horaSalidaReal}`,
      disp.viajeActual.planCodigo ? `Plan ${disp.viajeActual.planCodigo}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
  } else if (porIncidencia) {
    const i = disp.incidenciasBloqueantes[0];
    detalle = `${i.tipo}: ${i.fechaInicio} — ${i.fechaFin}`;
  } else if (sinVinculo) {
    detalle = "Personal sin vínculo con colaborador";
  }

  const otrosPlanes = disp.otrosPlanesDelDia.filter((pl) => pl.planId !== planIdActual);
  const incidenciaInfo = disp.advertencias.find(
    (a): a is Extract<AdvertenciaPersonal, { tipo: "incidencia_informativa" }> =>
      a.tipo === "incidencia_informativa",
  );

  return (
    <span className="flex flex-wrap items-center gap-1 text-[12px]">
      <span>{nombre}</span>
      <span title={detalle || undefined}>
        {ESTADO_PERSONA_ICONO[disp.estadoDisponibilidad]} {etiqueta}
      </span>
      {otrosPlanes.length ? (
        <span
          className="rounded bg-amber-900/40 px-1 py-0.5 text-[10px] text-amber-200"
          title={otrosPlanes
            .map(
              (pl) =>
                `${pl.planCodigo} · ${pl.horaCarga ?? "—"}${pl.placa ? ` · ${pl.placa}` : ""}${
                  pl.origen || pl.destino ? ` · ${pl.origen ?? "—"} → ${pl.destino ?? "—"}` : ""
                }`,
            )
            .join(" | ")}
        >
          ⚠ Otro viaje hoy{otrosPlanes.length > 1 ? ` (${otrosPlanes.length})` : ""}
        </span>
      ) : null}
      {incidenciaInfo ? (
        <span
          className="rounded bg-sky-900/30 px-1 py-0.5 text-[10px] text-sky-200"
          title={`${incidenciaInfo.incidencia.fechaInicio} — ${incidenciaInfo.incidencia.fechaFin}`}
        >
          ℹ {incidenciaInfo.incidencia.tipo}
        </span>
      ) : null}
    </span>
  );
}

/** Suma/resta días a una fecha YYYY-MM-DD sin problemas de huso horario. */
function sumarDias(iso: string, dias: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const fecha = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  fecha.setUTCDate(fecha.getUTCDate() + dias);
  return `${fecha.getUTCFullYear()}-${String(fecha.getUTCMonth() + 1).padStart(2, "0")}-${String(
    fecha.getUTCDate(),
  ).padStart(2, "0")}`;
}

function rangoFechas(hoy: string, rango: Rango): { desde: string; hasta: string } {
  if (rango === "hoy") return { desde: hoy, hasta: hoy };
  if (rango === "manana") {
    const manana = sumarDias(hoy, 1);
    return { desde: manana, hasta: manana };
  }
  return { desde: hoy, hasta: sumarDias(hoy, 6) };
}

/** Origen (primera parada tipo Carga) y destino (última Descarga/Entrega). */
function origenDestino(paradas: ParadaPlan[]): {
  origen: string | null;
  destino: string | null;
  intermedias: number;
} {
  if (!paradas.length) return { origen: null, destino: null, intermedias: 0 };
  const ordenadas = [...paradas].sort((a, b) => a.orden - b.orden);
  const origen = ordenadas.find((p) => p.tipo === "Carga")?.lugar_nombre ?? null;
  const destino =
    [...ordenadas].reverse().find((p) => p.tipo === "Descarga" || p.tipo === "Entrega")
      ?.lugar_nombre ?? null;
  const usadas = (origen ? 1 : 0) + (destino ? 1 : 0);
  return { origen, destino, intermedias: Math.max(0, ordenadas.length - usadas) };
}

type FiltroRapido =
  | "todos"
  | "sin_piloto"
  | "sin_unidad"
  | "sin_auxiliares"
  | "Programado"
  | "En ruta"
  | "Descargado";

type DatosProgramacion = {
  planes: Plan[];
  estadoVehiculos: EstadoVehiculo[];
};

/**
 * Fetch puro, sin tocar estado de React — lo reutilizan tanto el efecto de
 * montaje como el botón "Actualizar", cada uno aplicando el resultado a su
 * propio estado por separado (ver nota en el useEffect de abajo).
 */
async function obtenerProgramacion(
  slug: string,
): Promise<{ ok: true; datos: DatosProgramacion } | { ok: false; error: string }> {
  const res = await fetch(`/api/empresas/${slug}/tms/planes`);
  const data = await res.json();
  if (!res.ok) {
    return { ok: false, error: data.error ?? "No se pudo cargar la programación." };
  }
  return {
    ok: true,
    datos: {
      planes: (data.planes ?? []) as Plan[],
      estadoVehiculos: (data.estadoVehiculos ?? []) as EstadoVehiculo[],
    },
  };
}

type Props = { slug: string; hoy: string };

export function ProgramacionClient({ slug, hoy }: Props) {
  const [planes, setPlanes] = useState<Plan[]>([]);
  const [estadoVehiculos, setEstadoVehiculos] = useState<EstadoVehiculo[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  // Fase P4.2: disponibilidad de personal, una entrada por fecha (nunca por
  // persona ni por plan). fetchedFechasRef evita re-pedir una fecha ya
  // cargada sin meter el Map como dependencia del efecto (eso causaría un
  // loop: efecto -> setState -> Map cambia -> efecto de nuevo).
  const [disponibilidadPorFecha, setDisponibilidadPorFecha] = useState<
    Map<string, DisponibilidadPersonal[]>
  >(new Map());
  const fetchedFechasRef = useRef<Set<string>>(new Set());

  const [rango, setRango] = useState<Rango>("hoy");
  const [filtroRapido, setFiltroRapido] = useState<FiltroRapido>("todos");
  const [fPiloto, setFPiloto] = useState("");
  const [fUnidad, setFUnidad] = useState("");
  const [fCliente, setFCliente] = useState("");

  // Creación/edición de viajes: `mostrarCrear` abre el formulario en modo
  // creación; `editando` selecciona un plan del tablero para abrir el mismo
  // formulario en modo edición (mutuamente excluyentes).
  const [mostrarCrear, setMostrarCrear] = useState(false);
  const [editandoId, setEditandoId] = useState<number | null>(null);

  // Carga inicial: función definida DENTRO del efecto (patrón oficial de
  // React para "Fetching data with Effects", con bandera `ignore` para
  // evitar aplicar una respuesta obsoleta si `slug` cambia rápido). No usa
  // la función `cargar` de abajo — esa es la que dispara el botón
  // "Actualizar" (un manejador de clic, no un efecto).
  useEffect(() => {
    let ignore = false;
    async function cargarInicial() {
      setLoading(true);
      setErr("");
      const r = await obtenerProgramacion(slug).catch(
        () => ({ ok: false, error: "Error de conexión al cargar la programación." }) as const,
      );
      if (ignore) return;
      if (!r.ok) {
        setErr(r.error);
      } else {
        setPlanes(r.datos.planes);
        setEstadoVehiculos(r.datos.estadoVehiculos);
      }
      setLoading(false);
    }
    void cargarInicial();
    return () => {
      ignore = true;
    };
  }, [slug]);

  async function cargar() {
    setLoading(true);
    setErr("");
    try {
      const r = await obtenerProgramacion(slug);
      if (!r.ok) {
        setErr(r.error);
        return;
      }
      setPlanes(r.datos.planes);
      setEstadoVehiculos(r.datos.estadoVehiculos);
    } catch {
      setErr("Error de conexión al cargar la programación.");
    } finally {
      setLoading(false);
    }
  }

  const estadoPorPlaca = useMemo(() => {
    const m = new Map<string, EstadoVehiculo>();
    for (const v of estadoVehiculos) m.set(normPlaca(v.placa), v);
    return m;
  }, [estadoVehiculos]);

  /**
   * Estado visual de la unidad asignada al plan. Si la placa del plan no
   * aparece entre las unidades de Flota que la empresa puede ver (propias +
   * flota_vehiculo_acceso), NO se asume "disponible" ni "inactiva" — se
   * muestra un estado neutral, tal como se pidió.
   */
  function unidadEstado(
    placa: string | null,
  ): { label: string; badge: string; motivo: string | null } | null {
    if (!placa) return null; // sin unidad asignada, no aplica
    const v = estadoPorPlaca.get(normPlaca(placa));
    if (!v) {
      return {
        label: "Sin información de flota",
        badge: "bg-[var(--input)] text-[var(--muted)]",
        motivo: null,
      };
    }
    return {
      label: ESTADO_VEHICULO_LABEL[v.estadoDisponibilidad],
      badge: ESTADO_VEHICULO_BADGE[v.estadoDisponibilidad],
      motivo: v.motivoNoDisponible,
    };
  }

  const { desde, hasta } = rangoFechas(hoy, rango);

  // 1) Filtro de fecha (Hoy / Mañana / Semana) — SIEMPRE aplicado primero.
  const enRango = useMemo(
    () => planes.filter((p) => p.fecha_plan >= desde && p.fecha_plan <= hasta),
    [planes, desde, hasta],
  );

  // Fase P4.2: una llamada por FECHA ÚNICA visible (máximo 7, acotado por
  // "Semana"), nunca por persona ni por plan — evita N+1. listarDisponibilidadPersonal()
  // solo acepta una fecha a la vez (diseño aprobado, no se cambió su firma),
  // así que el batching real ocurre aquí, agrupando por fecha_plan.
  useEffect(() => {
    let ignore = false;
    const fechas = [...new Set(enRango.map((p) => p.fecha_plan))];
    const faltantes = fechas.filter((f) => !fetchedFechasRef.current.has(f));
    if (!faltantes.length) return;

    async function cargarDisponibilidadPersonal() {
      const entradas = await Promise.all(
        faltantes.map(async (fecha) => {
          try {
            const res = await fetch(
              `/api/empresas/${slug}/operaciones/disponibilidad-personal?fecha=${fecha}`,
            );
            const data = await res.json();
            const lista = res.ok ? ((data.personal ?? []) as DisponibilidadPersonal[]) : [];
            return [fecha, lista] as const;
          } catch {
            return [fecha, [] as DisponibilidadPersonal[]] as const;
          }
        }),
      );
      if (ignore) return;
      for (const f of faltantes) fetchedFechasRef.current.add(f);
      setDisponibilidadPorFecha((prev) => {
        const next = new Map(prev);
        for (const [fecha, lista] of entradas) next.set(fecha, lista);
        return next;
      });
    }
    void cargarDisponibilidadPersonal();
    return () => {
      ignore = true;
    };
  }, [enRango, slug]);

  // Opciones de los filtros secundarios, solo con lo que aparece en el rango.
  const opcionesPiloto = useMemo(
    () => [...new Set(enRango.map((p) => p.piloto).filter((x): x is string => Boolean(x)))].sort(),
    [enRango],
  );
  const opcionesUnidad = useMemo(
    () => [...new Set(enRango.map((p) => p.placa).filter((x): x is string => Boolean(x)))].sort(),
    [enRango],
  );
  const opcionesCliente = useMemo(
    () => [...new Set(enRango.map((p) => p.cliente).filter((x): x is string => Boolean(x)))].sort(),
    [enRango],
  );

  // 2) Filtro rápido (tarjetas resumen) + filtros de piloto/unidad/cliente.
  const visibles = useMemo(() => {
    return enRango.filter((p) => {
      if (filtroRapido === "sin_piloto" && p.piloto) return false;
      if (filtroRapido === "sin_unidad" && p.placa) return false;
      if (filtroRapido === "sin_auxiliares" && p.auxiliares.length > 0) return false;
      if (
        (filtroRapido === "Programado" ||
          filtroRapido === "En ruta" ||
          filtroRapido === "Descargado") &&
        p.estado !== filtroRapido
      ) {
        return false;
      }
      if (fPiloto && p.piloto !== fPiloto) return false;
      if (fUnidad && p.placa !== fUnidad) return false;
      if (fCliente && p.cliente !== fCliente) return false;
      return true;
    });
  }, [enRango, filtroRapido, fPiloto, fUnidad, fCliente]);

  const resumen = useMemo(
    () => ({
      total: enRango.length,
      programados: enRango.filter((p) => p.estado === "Programado").length,
      enRuta: enRango.filter((p) => p.estado === "En ruta").length,
      finalizados: enRango.filter((p) => p.estado === "Descargado").length,
      sinPiloto: enRango.filter((p) => !p.piloto).length,
      sinUnidad: enRango.filter((p) => !p.placa).length,
    }),
    [enRango],
  );

  const input =
    "rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1.5 text-sm";

  const planEditando = useMemo(
    () => (editandoId != null ? (planes.find((p) => p.id === editandoId) ?? null) : null),
    [planes, editandoId],
  );

  function cerrarFormulario() {
    setMostrarCrear(false);
    setEditandoId(null);
  }

  async function alGuardar() {
    cerrarFormulario();
    await cargar();
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
            Operaciones
          </p>
          <h1 className="mt-1 text-2xl font-semibold">Programación</h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">
            Pantalla operativa diaria: crea viajes, asigna piloto/auxiliares/
            unidad, reprograma y gestiona viáticos. Clic en un viaje para
            editarlo.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className="rounded bg-[var(--accent)] px-3 py-1.5 text-sm text-white disabled:opacity-40"
            disabled={loading}
            onClick={() => {
              setEditandoId(null);
              setMostrarCrear((v) => !v);
            }}
          >
            {mostrarCrear ? "Cancelar" : "+ Nuevo viaje"}
          </button>
          <button
            type="button"
            className="rounded bg-[#334155] px-3 py-1.5 text-sm text-white disabled:opacity-40"
            disabled={loading}
            onClick={() => void cargar()}
          >
            {loading ? "Actualizando…" : "Actualizar"}
          </button>
        </div>
      </div>

      {mostrarCrear ? (
        <PlanForm slug={slug} onSaved={() => void alGuardar()} onCancel={cerrarFormulario} />
      ) : null}
      {planEditando ? (
        <PlanForm
          slug={slug}
          plan={planEditando}
          onSaved={() => void alGuardar()}
          onCancel={cerrarFormulario}
        />
      ) : null}

      {err ? <p className="text-sm text-rose-300">{err}</p> : null}

      {/* Resumen — cada tarjeta también funciona como filtro rápido */}
      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {(
          [
            ["Total viajes", resumen.total, "todos"],
            ["Programados", resumen.programados, "Programado"],
            ["En ruta", resumen.enRuta, "En ruta"],
            ["Finalizados", resumen.finalizados, "Descargado"],
            ["Sin piloto", resumen.sinPiloto, "sin_piloto"],
            ["Sin unidad", resumen.sinUnidad, "sin_unidad"],
          ] as const
        ).map(([label, n, key]) => (
          <button
            key={key}
            type="button"
            onClick={() => setFiltroRapido(key)}
            className={[
              "rounded-xl border px-3 py-2 text-left transition",
              filtroRapido === key
                ? "border-[var(--accent)] bg-[var(--card)]"
                : "border-[var(--border)] bg-[var(--card)]/60 hover:border-[var(--accent)]/60",
            ].join(" ")}
          >
            <p className="text-[11px] text-[var(--muted)]">{label}</p>
            <p className="text-lg font-semibold tabular-nums">{n}</p>
          </button>
        ))}
      </div>

      {/* Rango de fechas */}
      <div className="flex flex-wrap gap-2">
        {(
          [
            ["hoy", "Hoy"],
            ["manana", "Mañana"],
            ["semana", "Semana"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setRango(key)}
            className={[
              "rounded-lg border px-3 py-1.5 text-sm font-medium transition",
              rango === key
                ? "border-[var(--accent)] bg-[var(--accent)] text-white"
                : "border-[var(--border)] bg-[var(--card)] hover:border-[var(--accent)]/60",
            ].join(" ")}
          >
            {label}
          </button>
        ))}
        <span className="self-center text-xs text-[var(--muted)]">
          {desde === hasta ? desde : `${desde} → ${hasta}`}
        </span>
      </div>

      {/* Filtros adicionales */}
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-[var(--muted)]">
          Estado
          <select
            className={`${input} mt-1 block`}
            value={
              filtroRapido === "Programado" ||
              filtroRapido === "En ruta" ||
              filtroRapido === "Descargado"
                ? filtroRapido
                : "todos"
            }
            onChange={(e) => setFiltroRapido(e.target.value as FiltroRapido)}
          >
            <option value="todos">Todos</option>
            <option value="Programado">Programado</option>
            <option value="En ruta">En ruta</option>
            <option value="Descargado">Finalizado</option>
          </select>
        </label>
        <label className="text-xs text-[var(--muted)]">
          Piloto
          <select
            className={`${input} mt-1 block`}
            value={fPiloto}
            onChange={(e) => setFPiloto(e.target.value)}
          >
            <option value="">Todos</option>
            {opcionesPiloto.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-[var(--muted)]">
          Unidad
          <select
            className={`${input} mt-1 block`}
            value={fUnidad}
            onChange={(e) => setFUnidad(e.target.value)}
          >
            <option value="">Todas</option>
            {opcionesUnidad.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-[var(--muted)]">
          Cliente
          <select
            className={`${input} mt-1 block`}
            value={fCliente}
            onChange={(e) => setFCliente(e.target.value)}
          >
            <option value="">Todos</option>
            {opcionesCliente.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* Tablero */}
      <div className="space-y-2">
        {visibles.map((p) => {
          const { origen, destino, intermedias } = origenDestino(p.paradas);
          const estadoUnidad = unidadEstado(p.placa);
          // Fase P4.3: cruce EXCLUSIVAMENTE por personalId — nunca por nombre.
          const dispDelDia = disponibilidadPorFecha.get(p.fecha_plan) ?? [];
          const dispPorPersonalId = new Map(
            dispDelDia.map((d) => [d.personalId, d]),
          );
          return (
            <div
              key={p.id}
              role="button"
              tabIndex={0}
              onClick={() => {
                setMostrarCrear(false);
                setEditandoId((cur) => (cur === p.id ? null : p.id));
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setMostrarCrear(false);
                  setEditandoId((cur) => (cur === p.id ? null : p.id));
                }
              }}
              className={[
                "cursor-pointer rounded-xl border p-4 transition hover:border-[var(--accent)]/60",
                editandoId === p.id
                  ? "border-[var(--accent)] bg-[var(--card)]"
                  : "border-[var(--border)] bg-[var(--card)]",
              ].join(" ")}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <span className="font-mono text-sm font-semibold text-sky-300">
                    {p.codigo}
                  </span>
                  <span className="ml-2 text-xs text-[var(--muted)]">
                    {p.fecha_plan}
                    {p.hora_carga ? ` · ${p.hora_carga.slice(0, 5)}` : ""}
                  </span>
                </div>
                <span
                  className={`rounded px-2 py-0.5 text-[11px] font-semibold ${
                    ESTADO_BADGE[p.estado] ?? "bg-[var(--input)] text-[var(--muted)]"
                  }`}
                >
                  {ESTADO_LABEL[p.estado] ?? p.estado}
                </span>
              </div>

              <div className="mt-2 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <p className="text-[11px] text-[var(--muted)]">Cliente</p>
                  <p>{p.cliente || "—"}</p>
                </div>
                <div>
                  <p className="text-[11px] text-[var(--muted)]">Ruta</p>
                  {origen || destino ? (
                    <p>
                      {origen || "—"} → {destino || "—"}
                      {intermedias > 0 ? (
                        <span className="ml-1 text-[11px] text-[var(--muted)]">
                          (+{intermedias} parada{intermedias > 1 ? "s" : ""})
                        </span>
                      ) : null}
                    </p>
                  ) : (
                    <p className="text-[var(--muted)]">Sin ruta registrada</p>
                  )}
                </div>
                <div>
                  <p className="text-[11px] text-[var(--muted)]">Piloto</p>
                  {p.piloto ? (
                    <PersonaEstado
                      nombre={p.piloto}
                      disp={p.pilotoId != null ? dispPorPersonalId.get(p.pilotoId) : undefined}
                      tieneId={p.pilotoId != null}
                      planIdActual={p.id}
                    />
                  ) : (
                    <p className="text-amber-300">Sin piloto</p>
                  )}
                </div>
                <div>
                  <p className="text-[11px] text-[var(--muted)]">Auxiliares</p>
                  {p.auxiliaresDetalle.length ? (
                    <div className="space-y-0.5">
                      {p.auxiliaresDetalle.map((aux) => (
                        <PersonaEstado
                          key={aux.personalId}
                          nombre={aux.nombre}
                          disp={dispPorPersonalId.get(aux.personalId)}
                          tieneId
                          planIdActual={p.id}
                        />
                      ))}
                    </div>
                  ) : (
                    <p className="text-[var(--muted)]">Sin auxiliares</p>
                  )}
                </div>
              </div>

              <div className="mt-3 grid gap-2 border-t border-[var(--border)] pt-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <p className="text-[11px] text-[var(--muted)]">Servicio</p>
                  <p>{p.tipo_traslado || "—"}</p>
                </div>
                <div>
                  <p className="text-[11px] text-[var(--muted)]">Regreso estimado</p>
                  <p>{p.regreso_estimado ? p.regreso_estimado.replace("T", " · ") : "—"}</p>
                </div>
                <div>
                  <p className="text-[11px] text-[var(--muted)]">Tarifa comercial</p>
                  <p>
                    {p.tarifa_comercial != null
                      ? `Q${Number(p.tarifa_comercial).toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                      : "—"}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] text-[var(--muted)]">Referencia cliente</p>
                  <p>{p.referencia_cliente || "—"}</p>
                </div>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="text-xs text-[var(--muted)]">Unidad:</span>
                {p.placa && estadoUnidad ? (
                  <>
                    <span className="font-mono text-sm font-semibold">
                      {p.placa}
                    </span>
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${estadoUnidad.badge}`}
                      title={estadoUnidad.motivo ?? undefined}
                    >
                      {estadoUnidad.label}
                    </span>
                  </>
                ) : (
                  <span className="rounded bg-amber-900/40 px-1.5 py-0.5 text-[10px] font-semibold text-amber-200">
                    Sin unidad
                  </span>
                )}
                {p.paradasPendientes > 0 ? (
                  <span className="rounded bg-amber-900/40 px-1.5 py-0.5 text-[10px] text-amber-200">
                    {p.paradasPendientes} parada(s) sin evidencia
                  </span>
                ) : null}
              </div>
            </div>
          );
        })}

        {!visibles.length && !loading ? (
          <p className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-8 text-center text-sm text-[var(--muted)]">
            No hay viajes programados con este filtro.
          </p>
        ) : null}
        {loading && !planes.length ? (
          <p className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-8 text-center text-sm text-[var(--muted)]">
            Cargando programación…
          </p>
        ) : null}
      </div>
    </div>
  );
}
