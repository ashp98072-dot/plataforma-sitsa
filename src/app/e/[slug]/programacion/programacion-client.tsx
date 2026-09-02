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
type AuxiliarPlan = {
  personalId: number;
  empleadoId: number | null;
  nombre: string;
  telefono: string | null;
};

export type Plan = {
  id: number;
  codigo: string;
  fecha_plan: string;
  hora_carga: string | null;
  estado: string;
  /** OPS-1: cierre administrativo. Null hasta que se cierra. */
  cerrado_por: string | null;
  cerrado_en: string | null;
  /**
   * OPS-1 (corregido): calculado en el backend (GET /tms/planes) — no es
   * un valor de estado. true cuando el plan no está Cerrado/Cancelado Y
   * ya existe un registro de llegada real en flota_viajes. MySQL lo
   * devuelve como 0/1, no como boolean nativo.
   */
  pendiente_cierre: number;
  /**
   * OPS-4.2e: indicador derivado (GET /tms/planes) — true cuando el plan
   * está "En ruta"/"Cargado", su regreso_estimado ya venció y TODAVÍA no
   * hay llegada técnica en flota_viajes. Mutuamente excluyente con
   * pendiente_cierre por diseño del backend (si ya hay llegada, es
   * pendiente_cierre, nunca atrasado) — no se revalida aquí. MySQL lo
   * devuelve como 0/1, no como boolean nativo. Opcional: si el GET no lo
   * trae (compatibilidad), se trata como ausente/false, sin romper la UI.
   */
  atrasado?: number;
  tipo_traslado: string | null;
  regreso_estimado: string | null;
  tarifa_comercial: number | null;
  referencia_cliente: string | null;
  /** VIAT-4/VIAT-4b: fotografía histórica de la ruta usada al armar el viaje. */
  ruta_id: number | null;
  ruta_codigo_historico: string | null;
  lugar_descarga_historico: string | null;
  contacto_nombre_historico: string | null;
  contacto_cargo_historico: string | null;
  contacto_telefono_historico: string | null;
  notas: string | null;
  cliente: string | null;
  placa: string | null;
  piloto: string | null;
  auxiliar: string | null;
  auxiliares: string[];
  /** Aditivo (Fase P4.3): id real del piloto, cuando el plan lo tiene. */
  pilotoId: number | null;
  pilotoEmpleadoId: number | null;
  pilotoTelefono: string | null;
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

export type Rango = "hoy" | "manana" | "semana";

const ESTADO_LABEL: Record<string, string> = {
  Programado: "Programado",
  // OPS-5.2d: "Cargado" = el vehículo ya fue cargado/preparado, pero
  // TODAVÍA no ha salido (definición aprobada del negocio) — sin label
  // propio antes, caía al fallback genérico (p.estado crudo). Marcarlo
  // sigue siendo opcional: un plan puede pasar directo de Programado a
  // En ruta sin pasar por aquí.
  Cargado: "Cargado",
  "En ruta": "En ruta",
  // Compatibilidad: planes históricos que ya quedaron en "Descargado" con
  // el flujo anterior. Ya no se genera para viajes nuevos.
  Descargado: "Pendiente de cierre",
  Cerrado: "Cerrado",
  Cancelado: "Cancelado",
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
  // OPS-5.2d: color propio, distinto de Programado (sky) y En ruta
  // (amber) — "Cargado" es un paso intermedio visualmente distinguible.
  Cargado: "bg-violet-900/50 text-violet-200",
  "En ruta": "bg-amber-900/50 text-amber-200",
  // Compatibilidad histórica (ver ESTADO_LABEL).
  Descargado: "bg-amber-900/50 text-amber-200",
  Cerrado: "bg-emerald-900/50 text-emerald-200",
  Cancelado: "bg-rose-900/40 text-rose-200",
};

/**
 * OPS-1 (corregido): "pendiente de cierre" ya no es siempre igual a
 * `estado` — para viajes nuevos, el plan sigue "En ruta" aunque el
 * piloto ya haya registrado llegada (ver Plan.pendiente_cierre, viene
 * calculado del backend). Esta función es la única fuente de verdad
 * para mostrar la etiqueta/color de estado en el tablero.
 */
function estadoVisible(p: Plan): { label: string; badge: string } {
  if (p.estado === "Cerrado" || p.estado === "Cancelado") {
    return { label: ESTADO_LABEL[p.estado], badge: ESTADO_BADGE[p.estado] };
  }
  if (p.pendiente_cierre) {
    return { label: "Pendiente de cierre", badge: "bg-amber-900/50 text-amber-200" };
  }
  return {
    label: ESTADO_LABEL[p.estado] ?? p.estado,
    badge: ESTADO_BADGE[p.estado] ?? "bg-[var(--input)] text-[var(--muted)]",
  };
}

/**
 * OPS-AJUSTES (sección 16) — la tarjeta completa ya es clicable (abre
 * plan-form.tsx debajo), pero no había ninguna pista visual de qué hace
 * ese clic; el usuario tenía que "adivinar". Esta etiqueta es puramente
 * informativa (mismo onClick del contenedor padre, sin lógica propia) —
 * no cambia ningún permiso ni flujo, solo aclara la acción esperada
 * según el estado real/derivado del plan.
 */
function accionVisible(p: Plan): string {
  if (p.estado === "Cerrado") return "Ver expediente";
  if (p.pendiente_cierre) return "Revisar y cerrar";
  return "Editar / Ajustes";
}

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

/**
 * TMS-PROGRAMACION-NAVEGACION-DIRECTA-PLAN — dado "hoy" y la fecha_plan de
 * un plan traído puntualmente por id (?plan=ID desde TMS), decide a qué
 * período (Hoy/Mañana/Semana) debe cambiarse el filtro para que ese plan
 * quede dentro del rango visible del tablero. `null` = ningún período lo
 * contiene — rangoFechas() de arriba SIEMPRE cubre "hoy en adelante"
 * (Hoy/Mañana/Semana nunca incluyen una fecha pasada), así que un plan de
 * ayer (o antes) no tiene período al que cambiar: el llamador debe avisar
 * en vez de fingir un ajuste de filtro que no existe. Función pura, sin
 * estado de React — extraída así para poder probarse sin infraestructura
 * de testing de componentes (no hay @testing-library/react en este
 * proyecto).
 */
export function rangoQueContiene(hoy: string, fechaPlan: string): Rango | null {
  if (fechaPlan === hoy) return "hoy";
  if (fechaPlan === sumarDias(hoy, 1)) return "manana";
  if (fechaPlan > hoy && fechaPlan <= sumarDias(hoy, 6)) return "semana";
  return null;
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
  // OPS-1 (corregido): valor virtual, no un estado real — filtra por
  // Plan.pendiente_cierre, no por p.estado === "Descargado".
  | "PendienteCierre"
  | "Cerrado";

type DatosProgramacion = {
  planes: Plan[];
  /**
   * OPS-2.1 — lista COMPLETA de pendientes de cierre, pedida aparte con
   * `pendienteCierre=1` (sin límite, sin depender del rango de fechas
   * visible). Antes se calculaba recortando el mismo array de `planes`
   * ya limitado a 200 filas y al rango Hoy/Mañana/Semana — un viaje
   * antiguo pendiente de cierre podía quedar fuera de ambos recortes y
   * desaparecer del tablero sin aviso.
   */
  pendientesCierre: Plan[];
  estadoVehiculos: EstadoVehiculo[];
};

/**
 * Fetch puro, sin tocar estado de React — lo reutilizan tanto el efecto de
 * montaje como el botón "Actualizar", cada uno aplicando el resultado a su
 * propio estado por separado (ver nota en el useEffect de abajo).
 *
 * OPS-2.1: dos peticiones en paralelo, no una — la lista principal ahora
 * pide al servidor solo el rango de fechas visible (fechaDesde/fechaHasta,
 * mismos nombres que ya usa /tms/programacion/reporte) en vez de traer
 * hasta 200 viajes y filtrar el rango en el navegador; la de pendientes de
 * cierre se pide aparte, siempre completa, para que la tarjeta resumen y
 * el filtro "Pendiente de cierre" nunca dependan del rango visible.
 */
async function obtenerProgramacion(
  slug: string,
  desde: string,
  hasta: string,
): Promise<{ ok: true; datos: DatosProgramacion } | { ok: false; error: string }> {
  const [resPlanes, resPendientes] = await Promise.all([
    fetch(`/api/empresas/${slug}/tms/planes?fechaDesde=${desde}&fechaHasta=${hasta}`),
    fetch(`/api/empresas/${slug}/tms/planes?pendienteCierre=1`),
  ]);
  const dataPlanes = await resPlanes.json();
  if (!resPlanes.ok) {
    return { ok: false, error: dataPlanes.error ?? "No se pudo cargar la programación." };
  }
  // La lista de pendientes es un complemento del tablero (resumen + filtro
  // rápido) — si esta segunda petición falla, no debe tumbar la pantalla
  // completa; se degrada a vacío y "Actualizar" la vuelve a intentar.
  const dataPendientes = await resPendientes.json().catch(() => ({}));
  const pendientesCierre = resPendientes.ok
    ? ((dataPendientes.planes ?? []) as Plan[])
    : [];
  return {
    ok: true,
    datos: {
      planes: (dataPlanes.planes ?? []) as Plan[],
      pendientesCierre,
      estadoVehiculos: (dataPlanes.estadoVehiculos ?? []) as EstadoVehiculo[],
    },
  };
}

type Props = { slug: string; hoy: string; planInicialId?: number | null };

// OPS-2.2: sondeo pasivo cada 30s (antes 5s) — ver el efecto de carga más
// abajo para el resto de las reglas de polling inteligente (pestaña
// oculta, refresh inmediato al volver, sin requests superpuestos).
const POLLING_MS = 30_000;

export function ProgramacionClient({ slug, hoy, planInicialId = null }: Props) {
  const [planes, setPlanes] = useState<Plan[]>([]);
  // OPS-2.1: lista completa e independiente del rango de fechas — ver
  // DatosProgramacion.pendientesCierre.
  const [pendientesCierre, setPendientesCierre] = useState<Plan[]>([]);
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

  // VIAT-4 (punto 5) — la empresa normalmente programa un día antes: la
  // vista inicial de Programación abre en "Mañana", no "Hoy". Botones Hoy/
  // Mañana/Semana siguen disponibles para cambiarlo.
  const [rango, setRango] = useState<Rango>("manana");
  const [filtroRapido, setFiltroRapido] = useState<FiltroRapido>("todos");
  const [fPiloto, setFPiloto] = useState("");
  const [fUnidad, setFUnidad] = useState("");
  const [fCliente, setFCliente] = useState("");

  // OPS-2.1: se calcula aquí arriba (no más abajo, junto a `enRango` como
  // antes) porque el efecto de carga ahora depende de desde/hasta — el
  // servidor filtra por fecha, ya no el navegador sobre un array de hasta
  // 200 filas.
  const { desde, hasta } = rangoFechas(hoy, rango);

  // Creación/edición de viajes: `mostrarCrear` abre el formulario en modo
  // creación; `editando` selecciona un plan del tablero para abrir el mismo
  // formulario en modo edición (mutuamente excluyentes).
  const [mostrarCrear, setMostrarCrear] = useState(false);
  const [editandoId, setEditandoId] = useState<number | null>(planInicialId);
  const [avisoRango, setAvisoRango] = useState("");
  // TMS-PROGRAMACION-NAVEGACION-DIRECTA-PLAN: plan traído por su id (enlace
  // "Ver en Programación" desde TMS, ?plan=ID), independiente de Hoy/
  // Mañana/Semana — ver el efecto de abajo. Solo se usa como fallback en
  // `planEditando`: en cuanto `planes`/`pendientesCierre` también lo
  // traigan (p. ej. porque el rango se ajustó para incluirlo), esas listas
  // ya "vivas" tienen prioridad.
  const [planDirecto, setPlanDirecto] = useState<Plan | null>(null);

  // VIAT-4 (puntos 8-10) — reporte tradicional de Programación (Excel/PDF).
  // Fecha específica: dejar "hasta" igual a "desde". Rango: ajustar ambos.
  const [exportDesde, setExportDesde] = useState(hoy);
  const [exportHasta, setExportHasta] = useState(hoy);

  // Carga inicial: función definida DENTRO del efecto (patrón oficial de
  // React para "Fetching data with Effects", con bandera `ignore` para
  // evitar aplicar una respuesta obsoleta si `slug` cambia rápido). No usa
  // la función `cargar` de abajo — esa es la que dispara el botón
  // "Actualizar" (un manejador de clic, no un efecto).
  //
  // OPS-2.1: depende también de desde/hasta — al cambiar Hoy/Mañana/Semana
  // se vuelve a consultar el servidor con el rango correcto (antes solo
  // filtraba en el navegador el array ya cargado).
  //
  // OPS-2.2 (polling inteligente):
  // - Intervalo normal 5s -> POLLING_MS (30s) — ver constante arriba.
  // - Con la pestaña oculta (document.visibilityState !== "visible") el
  //   tick del intervalo no dispara ningún fetch; al volver visible se
  //   refresca de inmediato y se reinicia el conteo de 30s (para no
  //   encadenar un segundo refresh a los pocos segundos del primero).
  // - `enVuelo` es un candado ÚNICO compartido por la carga inicial y los
  //   refrescos automáticos (tick de polling y visibilitychange) de ESTE
  //   efecto — si la carga inicial tarda más de 30s, el primer tick no
  //   arranca otro fetch encima; y viceversa. El botón "Actualizar"
  //   (cargar(), más abajo) y el refresh explícito tras guardar
  //   (alGuardar -> cargar()) NO comparten este candado — siguen
  //   pudiendo dispararse en cualquier momento, ya protegidos por su
  //   propio `disabled={loading}` en el JSX.
  useEffect(() => {
    let ignore = false;
    let enVuelo = false;
    let intervalo: number | undefined;

    /**
     * `silencioso=false` (carga inicial): setLoading/setErr como antes,
     * y un error de red se muestra. `silencioso=true` (polling/
     * visibilitychange): sin loading, y un fallo se descarta en
     * silencio — se conserva el último dato válido, sin error repetido.
     */
    async function ejecutarRefresh(silencioso: boolean) {
      if (enVuelo) return;
      enVuelo = true;
      if (!silencioso) {
        setLoading(true);
        setErr("");
      }
      try {
        if (silencioso) {
          const r = await obtenerProgramacion(slug, desde, hasta).catch(() => null);
          if (!ignore && r?.ok) {
            setPlanes(r.datos.planes);
            setPendientesCierre(r.datos.pendientesCierre);
            setEstadoVehiculos(r.datos.estadoVehiculos);
          }
        } else {
          const r = await obtenerProgramacion(slug, desde, hasta).catch(
            () => ({ ok: false, error: "Error de conexión al cargar la programación." }) as const,
          );
          if (ignore) return;
          if (!r.ok) {
            setErr(r.error);
          } else {
            setPlanes(r.datos.planes);
            setPendientesCierre(r.datos.pendientesCierre);
            setEstadoVehiculos(r.datos.estadoVehiculos);
          }
        }
      } finally {
        enVuelo = false;
        if (!silencioso) setLoading(false);
      }
    }

    function iniciarIntervalo() {
      window.clearInterval(intervalo);
      intervalo = window.setInterval(() => {
        if (document.visibilityState === "visible") void ejecutarRefresh(true);
      }, POLLING_MS);
    }

    void ejecutarRefresh(false); // carga inicial
    iniciarIntervalo();

    function onVisibilityChange() {
      if (document.visibilityState === "visible") {
        void ejecutarRefresh(true);
        iniciarIntervalo();
      }
    }
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      ignore = true;
      window.clearInterval(intervalo);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [slug, desde, hasta]);

  // TMS-PROGRAMACION-NAVEGACION-DIRECTA-PLAN: si llegó ?plan=ID desde TMS
  // ("Ver en Programación"), trae ESE plan puntual por id — sin depender
  // de qué período (Hoy/Mañana/Semana) esté seleccionado — y, cuando es
  // posible, ajusta el período al que sí lo contiene. `planInicialId` es
  // un valor inicial que llega del servidor (prop, no cambia durante la
  // vida del componente) — este efecto corre una sola vez al montar, sin
  // interferir con cambios posteriores de Hoy/Mañana/Semana hechos por el
  // usuario.
  useEffect(() => {
    if (!planInicialId) return;
    let ignore = false;
    (async () => {
      let plan: Plan | undefined;
      try {
        const res = await fetch(`/api/empresas/${slug}/tms/planes?id=${planInicialId}`);
        const data = await res.json().catch(() => ({}));
        if (ignore) return;
        plan = res.ok ? ((data.planes ?? [])[0] as Plan | undefined) : undefined;
      } catch {
        if (ignore) return;
        setAvisoRango("No se pudo cargar el plan solicitado por enlace directo.");
        return;
      }
      if (!plan) {
        // No existe, o pertenece a otra empresa (el backend siempre filtra
        // por empresa_id) — nunca se distingue cuál de las dos: mismo
        // criterio de "no revelar existencia" ya usado en otros módulos.
        setAvisoRango(
          `No se encontró el plan solicitado (#${planInicialId}). Puede que ya no exista o pertenezca a otra empresa.`,
        );
        return;
      }
      setPlanDirecto(plan);
      const contenedor = rangoQueContiene(hoy, plan.fecha_plan);
      if (contenedor) {
        setRango(contenedor);
      } else {
        setAvisoRango(
          `Mostrando el plan ${plan.codigo} (fecha ${plan.fecha_plan}), fuera del rango visible Hoy/Mañana/Semana. Ajusta los filtros de fecha para verlo también en el tablero.`,
        );
      }
    })();
    return () => {
      ignore = true;
    };
  }, [planInicialId, slug, hoy]);

  async function cargar() {
    setLoading(true);
    setErr("");
    try {
      const r = await obtenerProgramacion(slug, desde, hasta);
      if (!r.ok) {
        setErr(r.error);
        return;
      }
      setPlanes(r.datos.planes);
      setPendientesCierre(r.datos.pendientesCierre);
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

  // OPS-2.1: el servidor ya devuelve solo el rango desde/hasta pedido —
  // este filtro queda como respaldo defensivo (por ejemplo, si `planes`
  // trae datos de un fetch anterior a un cambio de rango que aún no
  // resolvió), no como el mecanismo principal de acotar por fecha.
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
  // OPS-2.1: "Pendiente de cierre" parte de `pendientesCierre` (completo,
  // sin recorte de fecha) en vez de `enRango` — es justamente el filtro
  // que debe poder consultarse sin depender del rango de fechas visible.
  const baseFiltroRapido = filtroRapido === "PendienteCierre" ? pendientesCierre : enRango;
  const visibles = useMemo(() => {
    return baseFiltroRapido.filter((p) => {
      if (filtroRapido === "sin_piloto" && p.piloto) return false;
      if (filtroRapido === "sin_unidad" && p.placa) return false;
      if (filtroRapido === "sin_auxiliares" && p.auxiliares.length > 0) return false;
      if (filtroRapido === "Programado" && p.estado !== "Programado") return false;
      if (filtroRapido === "En ruta" && p.estado !== "En ruta") return false;
      // PendienteCierre: baseFiltroRapido ya ES la lista de pendientes.
      if (filtroRapido === "Cerrado" && p.estado !== "Cerrado") return false;
      if (fPiloto && p.piloto !== fPiloto) return false;
      if (fUnidad && p.placa !== fUnidad) return false;
      if (fCliente && p.cliente !== fCliente) return false;
      return true;
    });
  }, [baseFiltroRapido, filtroRapido, fPiloto, fUnidad, fCliente]);

  const resumen = useMemo(
    () => ({
      total: enRango.length,
      programados: enRango.filter((p) => p.estado === "Programado").length,
      enRuta: enRango.filter((p) => p.estado === "En ruta").length,
      // OPS-2.1: cuenta real y completa (pendientesCierre), no acotada al
      // rango de fechas visible — antes podía mostrar menos de los que
      // en realidad hay pendientes.
      finalizados: pendientesCierre.length,
      sinPiloto: enRango.filter((p) => !p.piloto).length,
      sinUnidad: enRango.filter((p) => !p.placa).length,
    }),
    [enRango, pendientesCierre],
  );

  const input =
    "rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1.5 text-sm";

  // OPS-2.1: también busca en `pendientesCierre` — un viaje pendiente de
  // cierre puede quedar fuera del rango de fechas visible (`planes`) y aun
  // así el usuario lo abre desde el filtro rápido "Pendiente de cierre".
  // TMS-PROGRAMACION-NAVEGACION-DIRECTA-PLAN: `planDirecto` es el último
  // fallback — el plan traído puntualmente por ?plan=ID cuando ni el
  // rango visible ni pendientesCierre lo cubren (p. ej. una fecha pasada).
  // En cuanto `planes`/`pendientesCierre` sí lo traigan (rango ajustado),
  // esas dos tienen prioridad sobre esta copia fija del montaje.
  const planEditando = useMemo(
    () =>
      editandoId != null
        ? (planes.find((p) => p.id === editandoId) ??
          pendientesCierre.find((p) => p.id === editandoId) ??
          (planDirecto?.id === editandoId ? planDirecto : null))
        : null,
    [planes, pendientesCierre, planDirecto, editandoId],
  );

  function cerrarFormulario() {
    setMostrarCrear(false);
    setEditandoId(null);
    setAvisoRango("");
  }

  /**
   * Tras crear/editar: refresca el listado y pasa DIRECTO al modo edición
   * del mismo viaje (para que los viáticos sugeridos, que solo existen una
   * vez que el viaje tiene id, queden a un clic — sin tener que ubicarlo a
   * mano en el tablero). Si su fecha cae fuera del filtro de rango activo
   * (Hoy/Mañana/Semana), cambia a "Semana" cuando entra en esos 7 días, o
   * deja un aviso claro cuando quedó más adelante — así el viaje nunca
   * "desaparece" solo porque el filtro no lo cubre.
   */
  async function alGuardar(info: { id: number; fechaPlan: string }) {
    setMostrarCrear(false);
    await cargar();
    setEditandoId(info.id);
    const { desde, hasta } = rangoFechas(hoy, rango);
    if (info.fechaPlan >= desde && info.fechaPlan <= hasta) {
      setAvisoRango("");
      return;
    }
    if (info.fechaPlan >= hoy && info.fechaPlan <= sumarDias(hoy, 6)) {
      setRango("semana");
      setAvisoRango("");
    } else {
      setAvisoRango(
        `El viaje quedó programado para ${info.fechaPlan}, fuera del rango visible actual (${desde === hasta ? desde : `${desde} → ${hasta}`}). Ajusta los filtros de fecha para verlo en el tablero.`,
      );
    }
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
        <PlanForm
          slug={slug}
          hoy={hoy}
          fechaSugerida={rango === "hoy" ? hoy : sumarDias(hoy, 1)}
          onSaved={(info) => void alGuardar(info)}
          onCancel={cerrarFormulario}
        />
      ) : null}
      {planEditando ? (
        <PlanForm
          slug={slug}
          hoy={hoy}
          plan={planEditando}
          onSaved={(info) => void alGuardar(info)}
          onCancel={cerrarFormulario}
        />
      ) : null}
      {avisoRango ? (
        <p className="rounded-lg border border-amber-700/60 bg-amber-900/20 px-3 py-2 text-sm text-amber-200">
          {avisoRango}
        </p>
      ) : null}

      {err ? <p className="text-sm text-rose-300">{err}</p> : null}

      {/* Resumen — cada tarjeta también funciona como filtro rápido */}
      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {(
          [
            ["Total viajes", resumen.total, "todos"],
            ["Programados", resumen.programados, "Programado"],
            ["En ruta", resumen.enRuta, "En ruta"],
            ["Pendientes de cierre", resumen.finalizados, "PendienteCierre"],
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
            onClick={() => {
              setRango(key);
              setAvisoRango("");
            }}
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
          {filtroRapido === "PendienteCierre"
            ? "Pendientes de cierre: se muestran todos, sin importar la fecha."
            : desde === hasta
              ? desde
              : `${desde} → ${hasta}`}
        </span>
      </div>

      {/* VIAT-4 (puntos 8-10) — reporte tradicional de Programación */}
      <div className="flex flex-wrap items-end gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] p-3">
        <label className="text-xs text-[var(--muted)]">
          Reporte desde
          <input
            type="date"
            className={`${input} mt-1 block`}
            value={exportDesde}
            onChange={(e) => setExportDesde(e.target.value)}
          />
        </label>
        <label className="text-xs text-[var(--muted)]">
          hasta
          <input
            type="date"
            className={`${input} mt-1 block`}
            value={exportHasta}
            onChange={(e) => setExportHasta(e.target.value)}
          />
        </label>
        <a
          href={`/api/empresas/${slug}/tms/programacion/reporte?formato=xlsx&fechaDesde=${exportDesde}&fechaHasta=${exportHasta}`}
          className="rounded bg-emerald-700 px-3 py-1.5 text-xs text-white hover:bg-emerald-600"
        >
          Exportar Excel
        </a>
        <a
          href={`/api/empresas/${slug}/tms/programacion/reporte?formato=pdf&fechaDesde=${exportDesde}&fechaHasta=${exportHasta}`}
          className="rounded bg-[#334155] px-3 py-1.5 text-xs text-white hover:bg-[#3f4b5f]"
        >
          Exportar PDF
        </a>
        <span className="text-[10px] text-[var(--muted)]">
          Reporte tradicional: Mes, Día, Placa, Piloto, Auxiliar 1, Auxiliar 2, Código, Cliente,
          Lugar de Carga, Hora, Lugar de Descarga. Usa la misma fecha en ambos campos para un día
          específico.
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
              filtroRapido === "PendienteCierre" ||
              filtroRapido === "Cerrado"
                ? filtroRapido
                : "todos"
            }
            onChange={(e) => setFiltroRapido(e.target.value as FiltroRapido)}
          >
            <option value="todos">Todos</option>
            <option value="Programado">Programado</option>
            <option value="En ruta">En ruta</option>
            <option value="PendienteCierre">Pendiente de cierre</option>
            <option value="Cerrado">Cerrado</option>
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
                <div className="flex flex-wrap items-center gap-1.5">
                  <span
                    className={`rounded px-2 py-0.5 text-[11px] font-semibold ${estadoVisible(p).badge}`}
                  >
                    {estadoVisible(p).label}
                  </span>
                  {/* OPS-4.2e: indicador adicional, no reemplaza el badge de
                      estado real de arriba — mutuamente excluyente con
                      "Pendiente de cierre" por diseño del backend (ver
                      Plan.atrasado). Solo visual: no cambia estado, flujo,
                      llegada, cierre ni asignaciones. */}
                  {p.atrasado ? (
                    <span
                      className="rounded bg-rose-900/50 px-2 py-0.5 text-[11px] font-semibold text-rose-200"
                      title="Superó el regreso estimado y aún no registra llegada."
                    >
                      Atrasado
                    </span>
                  ) : null}
                  <span className="rounded border border-[var(--border)] px-2 py-0.5 text-[11px] text-[var(--muted)]">
                    {accionVisible(p)}
                  </span>
                </div>
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
