"use client";

import { useEffect, useMemo, useState } from "react";

/**
 * Operaciones → Programación (Fase P3) — tablero de SOLO LECTURA.
 *
 * Consume tal cual GET /api/empresas/[slug]/tms/planes (el mismo endpoint
 * que ya usa la pantalla TMS existente) — no hay escritura, no hay estados
 * nuevos, no hay SQL nuevo. Todos los indicadores se calculan en el cliente
 * a partir de lo que el GET ya entrega hoy.
 */

type ParadaPlan = {
  id: number;
  orden: number;
  lugar_nombre: string;
  tipo: string;
  requiere_evidencia: boolean;
  evidencias: number;
};

type Plan = {
  id: number;
  codigo: string;
  fecha_plan: string;
  hora_carga: string | null;
  estado: string;
  tipo_traslado: string | null;
  notas: string | null;
  cliente: string | null;
  placa: string | null;
  piloto: string | null;
  auxiliar: string | null;
  auxiliares: string[];
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

  const [rango, setRango] = useState<Rango>("hoy");
  const [filtroRapido, setFiltroRapido] = useState<FiltroRapido>("todos");
  const [fPiloto, setFPiloto] = useState("");
  const [fUnidad, setFUnidad] = useState("");
  const [fCliente, setFCliente] = useState("");

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

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
            Operaciones
          </p>
          <h1 className="mt-1 text-2xl font-semibold">Programación</h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">
            Vista operativa de viajes programados. Solo lectura — para
            asignar, reprogramar o cancelar, usa TMS por ahora.
          </p>
        </div>
        <button
          type="button"
          className="rounded bg-[#334155] px-3 py-1.5 text-sm text-white disabled:opacity-40"
          disabled={loading}
          onClick={() => void cargar()}
        >
          {loading ? "Actualizando…" : "Actualizar"}
        </button>
      </div>

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
          return (
            <div
              key={p.id}
              className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4"
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
                  <p className={p.piloto ? "" : "text-amber-300"}>
                    {p.piloto || "Sin piloto"}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] text-[var(--muted)]">Auxiliares</p>
                  <p className={p.auxiliares.length ? "" : "text-[var(--muted)]"}>
                    {p.auxiliares.length ? p.auxiliares.join(", ") : "Sin auxiliares"}
                  </p>
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
