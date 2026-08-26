"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import ViaticosConfigPanel from "@/components/tms/viaticos-config-panel";
import ClienteUbicacionesAdmin from "@/components/tms/cliente-ubicaciones-admin";
import ClienteContactosAdmin from "@/components/tms/cliente-contactos-admin";
import { useEmpresaSession } from "@/lib/empresa-session";
import { tienePermiso } from "@/lib/permisos-shared";

/**
 * Operaciones → TMS / Logística — VIAT-1b/1c: centro de configuración/
 * administración/soporte operativo. Programación (src/app/e/[slug]/
 * programacion/) es la pantalla operativa diaria (crear/editar viajes,
 * asignar piloto/auxiliares/unidad, paradas, viáticos, estados) — esta
 * pantalla YA NO duplica ese formulario. Mismo backend/endpoints de
 * siempre, solo UI reorganizada en 3 secciones (VIAT-1c: se simplificó de
 * 4 a 3; VIAT-1/VIAT-2 agregaron temporalmente "Control de Viáticos" y
 * "Viáticos por pagar" aquí; VIAT-3 las traslada a su propio módulo
 * visible — Operaciones → Viáticos (src/app/e/[slug]/viaticos/) — porque
 * estaban "escondidas" dentro de TMS y el usuario no las encontraba. TMS
 * ya NO mantiene esas dos bandejas: solo conserva la configuración de
 * montos por puesto y un enlace directo al módulo):
 *   1. Configuración: viáticos predeterminados (ViaticosConfigPanel) +
 *      ubicaciones de clientes (ClienteUbicacionesAdmin) + enlace al
 *      módulo Viáticos para autorizar/pagar/liquidar.
 *   2. Viajes / control administrativo: tabla de solo lectura de
 *      GET /tms/planes con filtros, detalle y seguimiento de evidencias
 *      registradas desde el portal — no reasigna piloto/auxiliares/
 *      unidad/paradas, no cambia estado), enlace "Ver en Programación" y
 *      la bitácora de auditoría.
 *   3. Catálogos (clientes, unidades, pilotos, auxiliares, lugares) —
 *      resumen de solo lectura de GET /tms/catalogos, colapsado por
 *      defecto (<details>, sin JS adicional).
 */

type ClienteCat = {
  id: number;
  nombre: string;
  codigo?: string | null;
  nit?: string | null;
  telefono?: string | null;
  estado?: string | null;
};
type LugarCat = { id: number; nombre: string; tipo: string; direccion?: string | null };
type UnidadCat = { id: number; placa: string; tipo: string; marca?: string | null; modelo?: string | null; estado: string };
type PersonalCat = { id: number; id_empleado?: number | null; codigo?: string | null; nombre: string; tipo: string; telefono?: string | null; estado: string };

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
  /** OPS-1: cierre administrativo. Null hasta que se cierra. */
  cerrado_por: string | null;
  cerrado_en: string | null;
  /** OPS-1 (corregido): calculado en el backend — no es un valor de estado. Ver programacion-client.tsx. */
  pendiente_cierre: number;
  tipo_traslado: string | null;
  regreso_estimado: string | null;
  tarifa_comercial: number | null;
  referencia_cliente: string | null;
  notas: string | null;
  cliente: string | null;
  placa: string | null;
  piloto: string | null;
  auxiliar: string | null;
  auxiliares?: string[];
  paradas?: ParadaPlan[];
  paradasPendientes?: number;
  evidencias: number;
};

type EvidenciaTms = {
  id: number;
  tipo: string;
  parada_id: number | null;
  parada_nombre: string | null;
  parada_orden: number | null;
  nombre: string;
  latitud: number | null;
  longitud: number | null;
  capturadoEn: string | null;
  subidoPor: string | null;
  url: string;
};

type AudRow = {
  id: number;
  usuario: string | null;
  accion: string;
  modulo: string | null;
  detalle: string | null;
  creadoEn: string;
};

const inputCls =
  "rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1.5 text-sm";

function labelAccionAud(accion: string): string {
  switch (accion) {
    case "crear_ruta":
      return "Creó ruta";
    case "editar_ruta":
      return "Editó ruta";
    case "cancelar_ruta":
      return "Canceló ruta";
    case "salida_viaje":
      return "Salida (piloto)";
    case "llegada_viaje":
      // OPS-1 (corregido): el piloto solo registra llegada (respaldo
      // operativo) — ya NO cambia el estado del plan. El cierre
      // administrativo es una acción aparte, exclusiva de Operaciones,
      // ver "cerrar_viaje" abajo.
      return "Llegada registrada (piloto)";
    case "cerrar_viaje":
      return "Cerró viaje (Operaciones)";
    case "eliminar_evidencia":
      return "Eliminó evidencia";
    case "config_viatico":
      return "Configuró viático";
    case "editar_viatico":
      return "Editó viático";
    default:
      return accion;
  }
}

// OPS-1: mismas etiquetas visibles que Programación
// (programacion-client.tsx) — se repite aquí en vez de importar porque
// ese archivo es "use client" propio de otra pantalla, mismo criterio ya
// usado para otras constantes pequeñas duplicadas por pantalla en este
// proyecto.
const ESTADO_LABEL: Record<string, string> = {
  Programado: "Programado",
  "En ruta": "En ruta",
  // Compatibilidad: planes históricos ya marcados "Descargado" por el
  // flujo anterior. Ya no se genera para viajes nuevos.
  Descargado: "Pendiente de cierre",
  Cerrado: "Cerrado",
  Cancelado: "Cancelado",
};

/**
 * OPS-1 (corregido): "pendiente de cierre" ya no es siempre igual a
 * `estado` — para viajes nuevos el plan sigue "En ruta" aunque el
 * piloto ya haya registrado llegada (ver Plan.pendiente_cierre,
 * calculado por el backend).
 */
function estadoLabelVisible(p: Plan): string {
  if (p.estado === "Cerrado" || p.estado === "Cancelado") return ESTADO_LABEL[p.estado];
  if (p.pendiente_cierre) return "Pendiente de cierre";
  return ESTADO_LABEL[p.estado] ?? p.estado;
}

function fechaHoraEvidencia(valor: string | null): string {
  if (!valor) return "Fecha no disponible";
  const fecha = new Date(valor);
  if (Number.isNaN(fecha.getTime())) return valor;
  return new Intl.DateTimeFormat("es-GT", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(fecha);
}

// OPS-2.2: sondeo pasivo cada 30s (antes 5s), tanto para el listado de
// viajes como para las evidencias de la fila expandida — ver los efectos
// más abajo para el resto de las reglas de polling inteligente.
const POLLING_MS = 30_000;

export default function TmsPage() {
  const slug = String(useParams().slug);

  // --- Sección 3: catálogos (fuente única para el resumen y para el
  // buscador de cliente de la sección 1) ---
  const [clientesCat, setClientesCat] = useState<ClienteCat[]>([]);
  const [lugaresCat, setLugaresCat] = useState<LugarCat[]>([]);
  const [unidadesCat, setUnidadesCat] = useState<UnidadCat[]>([]);
  const [personalCat, setPersonalCat] = useState<PersonalCat[]>([]);
  const [catalogoMsg, setCatalogoMsg] = useState("");

  const cargarCatalogos = useCallback(async () => {
    const res = await fetch(`/api/empresas/${slug}/tms/catalogos`);
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      setClientesCat((data.clientes ?? []) as ClienteCat[]);
      setLugaresCat((data.lugares ?? []) as LugarCat[]);
      setUnidadesCat((data.unidades ?? []) as UnidadCat[]);
      setPersonalCat((data.personal ?? []) as PersonalCat[]);
    }
  }, [slug]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void cargarCatalogos();
  }, [cargarCatalogos]);

  const pilotosCat = useMemo(() => personalCat.filter((p) => p.tipo === "Piloto"), [personalCat]);
  const auxiliaresCat = useMemo(() => personalCat.filter((p) => p.tipo === "Auxiliar"), [personalCat]);

  // --- Sección 2: viajes / control administrativo ---
  const [planes, setPlanes] = useState<Plan[]>([]);
  const [loadingPlanes, setLoadingPlanes] = useState(true);
  const [fCodigo, setFCodigo] = useState("");
  const [fCliente, setFCliente] = useState("");
  const [fFecha, setFFecha] = useState("");
  const [fEstado, setFEstado] = useState("");
  const [expandido, setExpandido] = useState<number | null>(null);
  const [evidenciasPorPlan, setEvidenciasPorPlan] = useState<Record<number, EvidenciaTms[]>>({});
  const [cargandoEvidencias, setCargandoEvidencias] = useState(false);

  // OPS-2.1: esta tabla también está sujeta al recorte de 200 filas de
  // GET /tms/planes (mismo riesgo que Programación) — se complementa con
  // la lista COMPLETA de pendientes de cierre (pendienteCierre=1, sin
  // límite) para que uno antiguo nunca desaparezca de este seguimiento
  // tampoco. No se le agrega un rango de fechas propio (esta pantalla no
  // tenía uno) — solo se corrige el riesgo de pérdida silenciosa.
  const cargarPlanes = useCallback(async (mostrarCarga = true) => {
    if (mostrarCarga) setLoadingPlanes(true);
    try {
      const [resBase, resPendientes] = await Promise.all([
        fetch(`/api/empresas/${slug}/tms/planes`),
        fetch(`/api/empresas/${slug}/tms/planes?pendienteCierre=1`),
      ]);
      const dataBase = await resBase.json().catch(() => ({}));
      if (!resBase.ok) return;
      const base = (dataBase.planes ?? []) as Plan[];
      const dataPendientes = await resPendientes.json().catch(() => ({}));
      const pendientes = resPendientes.ok ? ((dataPendientes.planes ?? []) as Plan[]) : [];
      const vistos = new Set(base.map((p) => p.id));
      setPlanes([...base, ...pendientes.filter((p) => !vistos.has(p.id))]);
    } finally {
      if (mostrarCarga) setLoadingPlanes(false);
    }
  }, [slug]);

  // OPS-2.2 (polling inteligente): 5s -> POLLING_MS (30s), sin sondear con
  // la pestaña oculta, refresh inmediato + reinicio del conteo al volver
  // visible, y sin superponer un tick nuevo mientras el anterior sigue en
  // vuelo. Mismo criterio que Programación (programacion-client.tsx).
  useEffect(() => {
    let enVuelo = false;
    let intervalo: number | undefined;

    async function refrescar() {
      if (enVuelo) return;
      enVuelo = true;
      try {
        await cargarPlanes(false);
      } finally {
        enVuelo = false;
      }
    }

    function iniciarIntervalo() {
      window.clearInterval(intervalo);
      intervalo = window.setInterval(() => {
        if (document.visibilityState === "visible") void refrescar();
      }, POLLING_MS);
    }

    // eslint-disable-next-line react-hooks/set-state-in-effect
    void cargarPlanes();
    iniciarIntervalo();

    function onVisibilityChange() {
      if (document.visibilityState === "visible") {
        void refrescar();
        iniciarIntervalo();
      }
    }
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.clearInterval(intervalo);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [cargarPlanes]);

  // OPS-1 — cierre administrativo desde TMS/Seguimiento (mismo endpoint que
  // Programación; esta vista ya muestra hora de regreso/evidencias/
  // incidencias del expediente, así que sirve como la "revisión antes de
  // cerrar" sin construir un modal nuevo). El botón solo se OCULTA sin el
  // permiso — la autoridad real es el 403 del endpoint.
  const { permisos: permisosTms } = useEmpresaSession();
  const puedeCerrarViaje = tienePermiso(permisosTms, "viajes_cerrar", "editar");
  const [cerrandoId, setCerrandoId] = useState<number | null>(null);
  const [errorCierre, setErrorCierre] = useState("");

  async function cerrarViajeTms(planId: number) {
    setCerrandoId(planId);
    setErrorCierre("");
    try {
      const res = await fetch(`/api/empresas/${slug}/tms/planes/${planId}/cerrar`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorCierre(data.error ?? "No se pudo cerrar el viaje.");
        return;
      }
      await cargarPlanes(false);
    } catch {
      setErrorCierre("Error de conexión.");
    } finally {
      setCerrandoId(null);
    }
  }

  const planesFiltrados = useMemo(() => {
    return planes.filter((p) => {
      if (fCodigo && !p.codigo.toLowerCase().includes(fCodigo.trim().toLowerCase())) return false;
      if (fCliente && !(p.cliente ?? "").toLowerCase().includes(fCliente.trim().toLowerCase())) return false;
      if (fFecha && String(p.fecha_plan).slice(0, 10) !== fFecha) return false;
      if (fEstado && p.estado !== fEstado) return false;
      return true;
    });
  }, [planes, fCodigo, fCliente, fFecha, fEstado]);

  const estadosDisponibles = useMemo(
    () => [...new Set(planes.map((p) => p.estado))].sort(),
    [planes],
  );

  const cargarEvidencias = useCallback(async (planId: number, mostrarCarga = true) => {
    if (mostrarCarga) setCargandoEvidencias(true);
    try {
      const res = await fetch(`/api/empresas/${slug}/tms/evidencias?planId=${planId}`);
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setEvidenciasPorPlan((actual) => ({
          ...actual,
          [planId]: (data.evidencias ?? []) as EvidenciaTms[],
        }));
      }
    } finally {
      if (mostrarCarga) setCargandoEvidencias(false);
    }
  }, [slug]);

  // OPS-2.2: mismo criterio de polling inteligente — ya solo corría con
  // una fila expandida (expandido != null); ahora además: 5s -> POLLING_MS,
  // nada de sondeo con la pestaña oculta, y refresh inmediato + reinicio
  // del conteo al volver visible.
  useEffect(() => {
    if (expandido == null) return;
    // Se captura en una constante propia: dentro de `function refrescar()`
    // (una function declaration, no una arrow function) TypeScript no
    // conserva el angostamiento de `expandido !== null` del guard de
    // arriba para la variable capturada del closure.
    const planId = expandido;
    let enVuelo = false;
    let intervalo: number | undefined;

    async function refrescar() {
      if (enVuelo) return;
      enVuelo = true;
      try {
        await cargarEvidencias(planId, false);
      } finally {
        enVuelo = false;
      }
    }

    function iniciarIntervalo() {
      window.clearInterval(intervalo);
      intervalo = window.setInterval(() => {
        if (document.visibilityState === "visible") void refrescar();
      }, POLLING_MS);
    }

    // eslint-disable-next-line react-hooks/set-state-in-effect
    void cargarEvidencias(planId);
    iniciarIntervalo();

    function onVisibilityChange() {
      if (document.visibilityState === "visible") {
        void refrescar();
        iniciarIntervalo();
      }
    }
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.clearInterval(intervalo);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [cargarEvidencias, expandido]);

  // --- Bitácora (dentro de la sección 2 — administración avanzada de viajes) ---
  const [bitacora, setBitacora] = useState<AudRow[]>([]);
  const [mostrarBitacora, setMostrarBitacora] = useState(false);
  const cargarBitacora = useCallback(async () => {
    const res = await fetch(`/api/empresas/${slug}/auditoria?modulo=tms&limite=150`);
    const data = await res.json().catch(() => ({}));
    if (res.ok) setBitacora((data.auditoria ?? []) as AudRow[]);
  }, [slug]);

  async function crearClienteRapido() {
    const nombre = window.prompt("Nombre del cliente:");
    if (!nombre?.trim()) return;
    const res = await fetch(`/api/empresas/${slug}/tms/catalogos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "cliente", nombre: nombre.trim() }),
    });
    const data = await res.json();
    setCatalogoMsg(data.mensaje || data.error);
    if (res.ok) await cargarCatalogos();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">TMS / Logística</h1>
        <p className="text-sm text-[var(--muted)]">
          Configuración, catálogos y consulta administrativa. Para crear o
          editar un viaje (cliente, unidad, piloto, auxiliares, paradas,
          viáticos, estado) usa{" "}
          <Link href={`/e/${slug}/programacion`} className="text-[var(--accent)] underline">
            Operaciones → Programación
          </Link>
          .
        </p>
      </div>

      {/* 1. Configuración: viáticos predeterminados + ubicaciones de clientes + enlace al módulo Viáticos */}
      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-[0.15em] text-[var(--muted)]">
          1. Configuración
        </h2>
        <ViaticosConfigPanel slug={slug} />
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
          <p className="text-sm">
            Para autorizar, pagar/entregar o liquidar viáticos de cualquier viaje, usa el módulo
            dedicado:
          </p>
          <Link
            href={`/e/${slug}/viaticos`}
            className="mt-2 inline-block rounded bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white"
          >
            Ir al módulo Viáticos →
          </Link>
        </div>
        <div id="cliente-contactos">
          <ClienteContactosAdmin slug={slug} clientes={clientesCat} />
        </div>
        <ClienteUbicacionesAdmin slug={slug} clientes={clientesCat} />
      </section>

      {/* 2. Viajes / control administrativo (incluye bitácora) */}
      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-[0.15em] text-[var(--muted)]">
          2. Viajes / control administrativo
        </h2>

        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
          <p className="text-xs text-[var(--muted)]">
            TMS es solo consulta. Las evidencias las registra el piloto o personal asignado desde su portal.
            El avance de la ruta y la última ubicación reportada se actualizan cada 5 segundos.
          </p>

          <div className="mt-3 flex flex-wrap items-end gap-2">
            <label className="text-xs text-[var(--muted)]">
              Código
              <input className={`${inputCls} mt-0.5 block w-36`} value={fCodigo} onChange={(e) => setFCodigo(e.target.value)} />
            </label>
            <label className="text-xs text-[var(--muted)]">
              Cliente
              <input className={`${inputCls} mt-0.5 block w-40`} value={fCliente} onChange={(e) => setFCliente(e.target.value)} />
            </label>
            <label className="text-xs text-[var(--muted)]">
              Fecha
              <input type="date" className={`${inputCls} mt-0.5 block`} value={fFecha} onChange={(e) => setFFecha(e.target.value)} />
            </label>
            <label className="text-xs text-[var(--muted)]">
              Estado
              <select className={`${inputCls} mt-0.5 block`} value={fEstado} onChange={(e) => setFEstado(e.target.value)}>
                <option value="">Todos</option>
                {estadosDisponibles.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="rounded bg-[#334155] px-3 py-1.5 text-xs text-white"
              disabled={loadingPlanes}
              onClick={() => void cargarPlanes()}
            >
              {loadingPlanes ? "Actualizando…" : "Actualizar"}
            </button>
          </div>

          <div className="mt-3 overflow-x-auto rounded-xl border border-[var(--border)]">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-[#1F6AA5] text-white">
                <tr>
                  <th className="px-3 py-2">Código</th>
                  <th className="px-3 py-2">Fecha</th>
                  <th className="px-3 py-2">Cliente</th>
                  <th className="px-3 py-2">Placa</th>
                  <th className="px-3 py-2">Piloto</th>
                  <th className="px-3 py-2">Estado</th>
                  <th className="px-3 py-2">Evid.</th>
                  <th className="px-3 py-2">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {planesFiltrados.map((p) => {
                  const evidenciasPlan = evidenciasPorPlan[p.id] ?? [];
                  const evidenciasRecientes = [...evidenciasPlan].sort((a, b) => b.id - a.id);
                  const ultimaEvidencia = evidenciasRecientes[0] ?? null;
                  const paradasRequeridas = (p.paradas ?? []).filter((parada) => parada.requiere_evidencia);
                  const paradasCompletadas = paradasRequeridas.filter((parada) => parada.evidencias > 0);
                  const siguienteParada = paradasRequeridas.find((parada) => parada.evidencias < 1) ?? null;
                  return (
                  <Fragment key={p.id}>
                    <tr className="border-t border-[var(--border)]">
                      <td className="px-3 py-2">{p.codigo}</td>
                      <td className="px-3 py-2">{String(p.fecha_plan).slice(0, 10)}</td>
                      <td className="px-3 py-2">{p.cliente ?? "—"}</td>
                      <td className="px-3 py-2">{p.placa ?? "—"}</td>
                      <td className="px-3 py-2">{p.piloto ?? "—"}</td>
                      <td className="px-3 py-2">{estadoLabelVisible(p)}</td>
                      <td className="px-3 py-2">{Number(p.evidencias ?? 0)}</td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-2 text-xs">
                          <button
                            type="button"
                            className="text-sky-300 hover:underline"
                            onClick={() => setExpandido((cur) => (cur === p.id ? null : p.id))}
                          >
                            {expandido === p.id ? "Cerrar" : "Detalle"}
                          </button>
                          <Link href={`/e/${slug}/programacion?plan=${p.id}`} className="text-[var(--accent)] hover:underline">
                            Ver en Programación
                          </Link>
                        </div>
                      </td>
                    </tr>
                    {expandido === p.id ? (
                      <tr className="border-t border-[var(--border)] bg-black/10">
                        <td colSpan={8} className="px-3 py-3">
                          <div className="grid gap-3 sm:grid-cols-2">
                            <div>
                              <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted)]">
                                Datos comerciales
                              </p>
                              <p className="text-xs">Cliente: {p.cliente ?? "—"}</p>
                              <p className="text-xs">
                                Tarifa comercial:{" "}
                                {p.tarifa_comercial != null
                                  ? `Q${Number(p.tarifa_comercial).toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                                  : "—"}
                              </p>
                              <p className="text-xs">Referencia cliente: {p.referencia_cliente || "—"}</p>
                              <p className="text-xs">Tipo de traslado: {p.tipo_traslado || "—"}</p>
                              <p className="text-xs">
                                Regreso estimado: {p.regreso_estimado ? p.regreso_estimado.replace("T", " · ") : "—"}
                              </p>
                            </div>
                            <div>
                              <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted)]">
                                Personal y paradas
                              </p>
                              <p className="text-xs">
                                Auxiliares: {(p.auxiliares ?? []).length ? p.auxiliares!.join(", ") : p.auxiliar || "—"}
                              </p>
                              <p className="text-xs">Notas: {p.notas || "—"}</p>
                              {(p.paradas ?? []).length ? (
                                <ul className="mt-1 space-y-0.5 text-[11px] text-[var(--muted)]">
                                  {p.paradas!.map((pp) => (
                                    <li key={pp.id}>
                                      {pp.orden}. {pp.lugar_nombre} ({pp.tipo}) ·{" "}
                                      {pp.evidencias > 0 ? `${pp.evidencias} foto(s)` : pp.requiere_evidencia ? "pendiente" : "sin evidencia req."}
                                    </li>
                                  ))}
                                </ul>
                              ) : (
                                <p className="text-[11px] text-[var(--muted)]">Sin paradas registradas.</p>
                              )}
                            </div>
                          </div>
                          <div className="mt-3 rounded-lg border border-[var(--border)] bg-black/10 p-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="text-xs font-semibold">Seguimiento operativo</p>
                              <div className="flex items-center gap-2">
                                <span className="text-[11px] text-sky-300">
                                  {paradasCompletadas.length}/{paradasRequeridas.length} paradas con evidencia
                                </span>
                                {p.pendiente_cierre && puedeCerrarViaje ? (
                                  <button
                                    type="button"
                                    disabled={cerrandoId === p.id}
                                    onClick={() => void cerrarViajeTms(p.id)}
                                    className="rounded bg-amber-700 px-2 py-1 text-[11px] font-medium text-white disabled:opacity-50"
                                  >
                                    {cerrandoId === p.id ? "Cerrando…" : "Cerrar viaje"}
                                  </button>
                                ) : null}
                              </div>
                            </div>
                            {errorCierre && cerrandoId === null && p.pendiente_cierre ? (
                              <p className="mt-1 text-[11px] text-red-300">{errorCierre}</p>
                            ) : null}
                            <p className="mt-1 text-xs">
                              {p.estado === "Programado"
                                ? "Esperando que el piloto inicie el viaje."
                                : p.pendiente_cierre
                                  ? "Piloto registró la llegada — pendiente de cierre administrativo."
                                  : p.estado === "En ruta" && siguienteParada
                                    ? `En ruta · Siguiente parada: ${siguienteParada.orden}. ${siguienteParada.lugar_nombre}`
                                    : p.estado === "En ruta"
                                      ? "Ruta completada; pendiente regreso al predio."
                                      : p.estado === "Cerrado"
                                        ? `Viaje cerrado${p.cerrado_por ? ` por ${p.cerrado_por}` : ""}${p.cerrado_en ? ` · ${p.cerrado_en.replace("T", " ")}` : ""}.`
                                        : `Estado actual: ${p.estado}`}
                            </p>

                            {cargandoEvidencias && !evidenciasPlan.length ? (
                              <p className="mt-2 text-[11px] text-[var(--muted)]">Cargando evidencias…</p>
                            ) : ultimaEvidencia ? (
                              <div className="mt-2 text-[11px] text-[var(--muted)]">
                                <p>
                                  Último reporte: {ultimaEvidencia.tipo}
                                  {ultimaEvidencia.parada_nombre ? ` · ${ultimaEvidencia.parada_nombre}` : ""}
                                  {` · ${fechaHoraEvidencia(ultimaEvidencia.capturadoEn)}`}
                                </p>
                                <p>Registrado por: {ultimaEvidencia.subidoPor || "Usuario operativo"}</p>
                                {ultimaEvidencia.latitud != null && ultimaEvidencia.longitud != null ? (
                                  <a
                                    className="text-sky-300 underline"
                                    href={`https://www.google.com/maps?q=${ultimaEvidencia.latitud},${ultimaEvidencia.longitud}`}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    Ver última ubicación reportada en el mapa
                                  </a>
                                ) : (
                                  <p>Esta evidencia no contiene ubicación GPS.</p>
                                )}
                              </div>
                            ) : (
                              <p className="mt-2 text-[11px] text-[var(--muted)]">Aún no hay evidencias del viaje.</p>
                            )}

                            {evidenciasRecientes.length ? (
                              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                                {evidenciasRecientes.map((evidencia) => (
                                  <div
                                    key={evidencia.id}
                                    className="rounded border border-[var(--border)] p-2 text-[11px]"
                                  >
                                    <a href={evidencia.url} target="_blank" rel="noreferrer" className="block font-medium text-sky-300 hover:underline">{evidencia.tipo}</a>
                                    <span className="block">{evidencia.parada_nombre || "Evidencia general del viaje"}</span>
                                    <span className="block text-[var(--muted)]">{fechaHoraEvidencia(evidencia.capturadoEn)}</span>
                                    {evidencia.latitud != null && evidencia.longitud != null ? (
                                      <>
                                        <span className="block font-mono text-[var(--muted)]">GPS: {evidencia.latitud.toFixed(6)}, {evidencia.longitud.toFixed(6)}</span>
                                        <a href={`https://www.google.com/maps?q=${evidencia.latitud},${evidencia.longitud}`} target="_blank" rel="noreferrer" className="block text-sky-300 underline">Ver ubicación en el mapa</a>
                                      </>
                                    ) : <span className="block text-amber-300">Sin ubicación GPS</span>}
                                  </div>
                                ))}
                              </div>
                            ) : null}
                          </div>
                          <p className="mt-2 text-[10px] text-amber-200/80">
                            Información interna: los viáticos de este viaje NO se muestran aquí ni en ninguna vista de
                            cliente — se administran desde Programación.
                          </p>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                  );
                })}
                {!planesFiltrados.length && !loadingPlanes ? (
                  <tr>
                    <td colSpan={8} className="px-3 py-4 text-[var(--muted)]">
                      Sin viajes con este filtro.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <details className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
          <summary className="cursor-pointer text-sm font-medium">Bitácora de rutas</summary>
          <p className="mt-1 text-[11px] text-[var(--muted)]">
            Quién crea, edita, cancela, sale, cierra o elimina evidencias — con fecha y hora.
          </p>
          <button
            type="button"
            className="mt-2 rounded bg-[#334155] px-3 py-1.5 text-xs text-white"
            onClick={() => {
              if (!mostrarBitacora) void cargarBitacora();
              setMostrarBitacora(true);
            }}
          >
            Cargar bitácora
          </button>
          {mostrarBitacora ? (
            <div className="mt-2 max-h-80 overflow-auto rounded border border-[var(--border)]">
              <table className="min-w-full text-left text-xs">
                <thead className="sticky top-0 bg-[#1e293b] text-[var(--muted)]">
                  <tr>
                    <th className="px-2 py-1.5">Fecha / hora</th>
                    <th className="px-2 py-1.5">Usuario</th>
                    <th className="px-2 py-1.5">Acción</th>
                    <th className="px-2 py-1.5">Detalle</th>
                  </tr>
                </thead>
                <tbody>
                  {bitacora.map((a) => (
                    <tr key={a.id} className="border-t border-[var(--border)] align-top">
                      <td className="whitespace-nowrap px-2 py-1.5 font-mono text-[10px] text-sky-300">{a.creadoEn || "—"}</td>
                      <td className="px-2 py-1.5 font-medium">{a.usuario || "—"}</td>
                      <td className="px-2 py-1.5 text-amber-200">{labelAccionAud(a.accion)}</td>
                      <td className="px-2 py-1.5 text-[var(--muted)]">{a.detalle || "—"}</td>
                    </tr>
                  ))}
                  {!bitacora.length ? (
                    <tr>
                      <td colSpan={4} className="px-2 py-3 text-[var(--muted)]">
                        Aún no hay movimientos registrados.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          ) : null}
        </details>
      </section>

      {/* 3. Catálogos — colapsado por defecto para no saturar la pantalla; el resumen de solo lectura no es lo primero que necesita el día a día. */}
      <details className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <summary className="cursor-pointer text-xs font-semibold uppercase tracking-[0.15em] text-[var(--muted)]">
          3. Catálogos
        </summary>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium">Clientes, unidades, personal y lugares</p>
          <button type="button" className="rounded bg-[#334155] px-2 py-1 text-xs text-white" onClick={() => void crearClienteRapido()}>
            + Cliente rápido
          </button>
        </div>
        {catalogoMsg ? <p className="mt-1 text-xs text-emerald-300">{catalogoMsg}</p> : null}
        <div className="mt-3 grid gap-4 lg:grid-cols-2">
          <div>
            <p className="text-xs font-medium text-[var(--muted)]">Clientes ({clientesCat.length})</p>
            <ul className="mt-1 max-h-40 overflow-y-auto text-xs">
              {clientesCat.map((c) => (
                <li key={c.id} className="border-t border-[var(--border)] py-1">
                  {c.codigo ? `${c.codigo} · ` : ""}
                  {c.nombre}
                  {c.nit ? ` · NIT ${c.nit}` : ""}
                </li>
              ))}
              {!clientesCat.length ? <li className="py-1 text-[var(--muted)]">Sin clientes.</li> : null}
            </ul>
          </div>
          <div>
            <p className="text-xs font-medium text-[var(--muted)]">Unidades ({unidadesCat.length})</p>
            <ul className="mt-1 max-h-40 overflow-y-auto text-xs">
              {unidadesCat.map((u) => (
                <li key={u.id} className="border-t border-[var(--border)] py-1">
                  <span className="font-mono">{u.placa}</span> · {u.tipo}
                  {u.marca || u.modelo ? ` · ${[u.marca, u.modelo].filter(Boolean).join(" ")}` : ""} · {u.estado}
                </li>
              ))}
              {!unidadesCat.length ? <li className="py-1 text-[var(--muted)]">Sin unidades.</li> : null}
            </ul>
          </div>
          <div>
            <p className="text-xs font-medium text-[var(--muted)]">Pilotos ({pilotosCat.length})</p>
            <ul className="mt-1 max-h-40 overflow-y-auto text-xs">
              {pilotosCat.map((p) => (
                <li key={p.id} className="border-t border-[var(--border)] py-1">
                  {p.nombre} {p.codigo ? `(${p.codigo})` : ""} · {p.estado}
                  {p.id_empleado ? " · RRHH" : ""}
                </li>
              ))}
              {!pilotosCat.length ? <li className="py-1 text-[var(--muted)]">Sin pilotos.</li> : null}
            </ul>
          </div>
          <div>
            <p className="text-xs font-medium text-[var(--muted)]">Auxiliares ({auxiliaresCat.length})</p>
            <ul className="mt-1 max-h-40 overflow-y-auto text-xs">
              {auxiliaresCat.map((p) => (
                <li key={p.id} className="border-t border-[var(--border)] py-1">
                  {p.nombre} {p.codigo ? `(${p.codigo})` : ""} · {p.estado}
                  {p.id_empleado ? " · RRHH" : ""}
                </li>
              ))}
              {!auxiliaresCat.length ? <li className="py-1 text-[var(--muted)]">Sin auxiliares.</li> : null}
            </ul>
          </div>
          <div className="lg:col-span-2">
            <p className="text-xs font-medium text-[var(--muted)]">Lugares/paradas ({lugaresCat.length})</p>
            <ul className="mt-1 max-h-32 overflow-y-auto text-xs">
              {lugaresCat.map((l) => (
                <li key={l.id} className="border-t border-[var(--border)] py-1">
                  {l.nombre} · {l.tipo}
                  {l.direccion ? ` · ${l.direccion}` : ""}
                </li>
              ))}
              {!lugaresCat.length ? <li className="py-1 text-[var(--muted)]">Sin lugares registrados.</li> : null}
            </ul>
          </div>
        </div>
      </details>
    </div>
  );
}
