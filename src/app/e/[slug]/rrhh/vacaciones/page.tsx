"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { EvidenciasModal } from "@/components/rrhh/evidencias-modal";
import { EmpleadoPicker } from "@/components/rrhh/empleado-picker";
import { useEmpresaSession } from "@/lib/empresa-session";
import {
  eliminarUnaVez,
  puedeEliminarVacaciones,
  textoConfirmacion,
  tipoDescuentaSaldo,
  tipoEliminable,
  TIPOS_VACACIONES,
  type FilaHistorial,
} from "@/lib/rrhh/vacaciones-eliminar-ui";
import { SolicitudesVacacionesPanel } from "@/components/rrhh/solicitudes-vacaciones-panel";
import { VacacionesAlertasPanel } from "@/components/rrhh/vacaciones-alertas-panel";
import { HistorialPeriodosVacaciones } from "@/components/rrhh/historial-periodos-vacaciones";
import { ImportarHistorialVacaciones } from "@/components/rrhh/importar-historial-vacaciones";
import { ExportarHistorialVacaciones } from "@/components/rrhh/exportar-historial-vacaciones";
import { PendientesReparacionVacaciones } from "@/components/rrhh/pendientes-reparacion-vacaciones";
import { ModoCargaHistoricaVacaciones } from "@/components/rrhh/modo-carga-historica-vacaciones";
import { tienePermiso } from "@/lib/permisos-shared";
import { PrevisualizacionHistorica } from "@/components/rrhh/previsualizacion-historica-vacaciones";
import type { PrevisualizacionRegistro } from "@/lib/rrhh/vacaciones-registro";
import type { HistorialVacaciones } from "@/lib/rrhh/vacaciones";

type Emp = { id: number; codigo: string; nombre: string; dpi?: string };
type Periodo = {
  id: number;
  anioLaboral: number;
  periodoInicio: string;
  periodoFin: string;
  diasOtorgados: number;
  diasDisponibles: number;
};

// RRHH-VACACIONES-FILTROS-HISTORIAL-1: catálogo único, reutilizado (antes era una copia local en esta página).
const TIPOS = TIPOS_VACACIONES;

function fmtUi(iso: string | null | undefined): string {
  if (!iso) return "—";
  const p = String(iso).slice(0, 10);
  const [y, m, d] = p.split("-");
  if (!y || !m || !d || y.length !== 4) return p;
  return `${d}/${m}/${y}`;
}

export default function VacacionesPage() {
  const slug = String(useParams().slug);
  const { rol, permisos } = useEmpresaSession();
  const puedeEliminar = puedeEliminarVacaciones(rol, permisos);
  // Importar historial (solo vista previa): el endpoint exige RRHH · Vacaciones · editar; aquí solo se oculta la herramienta.
  const puedeImportarHistorial = rol === "Admin" || tienePermiso(permisos, "vacaciones", "editar");
  const [empleados, setEmpleados] = useState<Emp[]>([]);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [empleadoId, setEmpleadoId] = useState(0);
  const [tipo, setTipo] = useState<(typeof TIPOS)[number]>("Vacaciones");
  const [saldo, setSaldo] = useState<number | null>(null);
  const [periodos, setPeriodos] = useState<Periodo[]>([]);
  const [historial, setHistorial] = useState<HistorialVacaciones | null>(null);
  // Reparación administrada de series de períodos: RRHH · Vacaciones · editar (los endpoints lo exigen de nuevo). `versionReparacion` refresca el indicador.
  const puedeReparar = rol === "Admin" || tienePermiso(permisos, "vacaciones", "editar");
  const [versionReparacion, setVersionReparacion] = useState(0);
  // Modo de carga histórica (temporal, por empresa): cambiarlo exige RRHH · Configuración · editar (el servidor lo vuelve a exigir).
  const puedeCambiarModo = rol === "Admin" || tienePermiso(permisos, "configuracion", "editar");
  const [modoHistorico, setModoHistorico] = useState(false);
  const [aviso, setAviso] = useState("");
  // RRHH-VACACIONES-FILTROS-HISTORIAL-1 — estados INDEPENDIENTES del empleado/tipo del formulario de registro
  // (empleadoId/tipo arriba). 0/"" = sin filtro ("Todos"). Cambiar estos filtros nunca toca empleadoId/tipo/
  // fechaInicio/fechaFin/dias, y viceversa.
  const [filtroEmpleadoId, setFiltroEmpleadoId] = useState(0);
  const [filtroTipo, setFiltroTipo] = useState("");
  const [filtroDesde, setFiltroDesde] = useState("");
  const [filtroHasta, setFiltroHasta] = useState("");
  const [errorFiltros, setErrorFiltros] = useState("");
  const [fechaInicio, setFechaInicio] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [fechaFin, setFechaFin] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [dias, setDias] = useState("1");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  // Registro HISTÓRICO: vista previa del consumo en la fecha de la vacación (no el saldo de hoy) y decisión explícita de RRHH cuando se requiere.
  const [previa, setPrevia] = useState<(PrevisualizacionRegistro & { diasHabiles: number }) | null>(null);
  const [decisionAcepta, setDecisionAcepta] = useState(false);
  const [decisionMotivo, setDecisionMotivo] = useState("");
  const [evModal, setEvModal] = useState<{
    id: number;
    titulo: string;
  } | null>(null);
  // Eliminar registro: confirmación explícita, candado contra doble clic y errores que conservan la fila.
  const [porEliminar, setPorEliminar] = useState<Record<string, unknown> | null>(null);
  const [eliminando, setEliminando] = useState(false);
  const [errorEliminar, setErrorEliminar] = useState("");
  const eliminandoRef = useRef(false);

  // RRHH-VACACIONES-FILTROS-HISTORIAL-1 (punto 3) — SEPARADAS a propósito: cambiar un filtro del historial nunca
  // vuelve a pedir saldo/periodos (y viceversa), así ninguna de las dos responsabilidades pisa a la otra aunque
  // ambas lean del mismo endpoint GET con el mismo parámetro `empleadoId` (con significado distinto según la llamada
  // — el del formulario en una, el del filtro en la otra).
  const cargarFormularioEmpleado = useCallback(async () => {
    if (!empleadoId) { setSaldo(null); setPeriodos([]); setHistorial(null); setAviso(""); return; }
    // AJUSTE PR #376 (punto 1) — soloResumen=1: el backend calcula saldo/periodos SIN ejecutar listarVacaciones()
    // (antes esta llamada traía y descartaba el historial completo; ahora nunca lo toca).
    const v = await fetch(`/api/empresas/${slug}/rrhh/vacaciones?empleadoId=${empleadoId}&soloResumen=1`).then((r) => r.json());
    setSaldo(v.saldo ?? null);
    setPeriodos(v.periodos ?? []);
    setHistorial(v.historial ?? null);
    setAviso(v.aviso ?? "");
  }, [slug, empleadoId]);

  const cargarHistorial = useCallback(async () => {
    if (filtroDesde && filtroHasta && filtroDesde > filtroHasta) {
      setErrorFiltros("La fecha 'Desde' no puede ser posterior a 'Hasta'.");
      return;
    }
    setErrorFiltros("");
    const qs = new URLSearchParams();
    if (filtroEmpleadoId) qs.set("empleadoId", String(filtroEmpleadoId));
    if (filtroTipo) qs.set("tipo", filtroTipo);
    if (filtroDesde) qs.set("desde", filtroDesde);
    if (filtroHasta) qs.set("hasta", filtroHasta);
    const texto = qs.toString();
    const v = await fetch(`/api/empresas/${slug}/rrhh/vacaciones${texto ? `?${texto}` : ""}`).then((r) => r.json());
    if (Array.isArray(v.vacaciones)) setRows(v.vacaciones);
  }, [slug, filtroEmpleadoId, filtroTipo, filtroDesde, filtroHasta]);

  const cargarEmpleados = useCallback(async () => {
    const e = await fetch(`/api/empresas/${slug}/empleados`).then((r) => r.json());
    const lista: Emp[] = e.empleados ?? [];
    setEmpleados(lista);
    if (!empleadoId && lista[0]?.id) setEmpleadoId(lista[0].id);
  }, [slug, empleadoId]);

  useEffect(() => {
    const inicio = window.setTimeout(() => void cargarEmpleados(), 0);
    return () => window.clearTimeout(inicio);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al montar/cambiar de empresa; no en cada cambio de empleadoId.
  }, [slug]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga remota al cambiar el empleado del formulario
    void cargarFormularioEmpleado();
  }, [cargarFormularioEmpleado]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga remota al cambiar los filtros del historial
    void cargarHistorial();
  }, [cargarHistorial]);

  /** Refresco coordinado tras una mutación (registrar, eliminar, evidencias, solicitudes) — recarga saldo/periodos
   * del formulario Y el historial filtrado, sin que ninguno de los dos cambie los estados del otro. */
  const cargar = useCallback(async () => {
    await Promise.all([cargarFormularioEmpleado(), cargarHistorial()]);
  }, [cargarFormularioEmpleado, cargarHistorial]);

  function limpiarFiltrosHistorial() {
    setFiltroEmpleadoId(0);
    setFiltroTipo("");
    setFiltroDesde("");
    setFiltroHasta("");
    setErrorFiltros("");
  }

  useEffect(() => {
    if (!fechaInicio || !fechaFin) return;
    const t = setTimeout(async () => {
      const res = await fetch(
        `/api/empresas/${slug}/rrhh/vacaciones/dias-habiles?inicio=${fechaInicio}&fin=${fechaFin}`,
      );
      const data = await res.json();
      if (res.ok && typeof data.dias === "number") setDias(String(data.dias));
    }, 300);
    return () => clearTimeout(t);
  }, [slug, fechaInicio, fechaFin]);

  // Vista previa del registro histórico: solo cuando el tipo descuenta saldo. No limita las fechas del formulario por períodos vigentes.
  useEffect(() => {
    const diasNum = Number(dias);
    if (!empleadoId || !fechaInicio || !fechaFin || fechaFin < fechaInicio || !Number.isFinite(diasNum) || diasNum <= 0 || !(tipo === "Vacaciones" || tipo === "A cuenta de Vacaciones")) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- limpia la vista previa cuando el formulario deja de ser evaluable
      setPrevia(null);
      return;
    }
    let vigente = true;
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/empresas/${slug}/rrhh/vacaciones/preview-historico?empleadoId=${empleadoId}&fechaInicio=${fechaInicio}&fechaFin=${fechaFin}&diasHabiles=${diasNum}`);
        const data = await res.json();
        if (vigente) { setPrevia(res.ok && data.esHistorico ? data : null); setDecisionAcepta(false); setDecisionMotivo(""); }
      } catch {
        if (vigente) setPrevia(null);
      }
    }, 400);
    return () => { vigente = false; clearTimeout(t); };
  }, [slug, empleadoId, fechaInicio, fechaFin, dias, tipo]);

  async function onSubmit(ev: FormEvent) {
    ev.preventDefault();
    setError("");
    setMsg("");
    const diasNum = Number(dias);
    if (!Number.isFinite(diasNum) || diasNum <= 0) {
      setError("Días hábiles inválidos.");
      return;
    }
    const plan = previa?.plan ?? null;
    if (previa && plan) {
      if (plan.bloqueos.length || previa.superposiciones.length) {
        setError(plan.bloqueos[0]?.mensaje ?? "La vacación se superpone con otra ya registrada.");
        return;
      }
      if (plan.requiereDecision && (!decisionAcepta || decisionMotivo.trim().length < 10)) {
        setError("Este registro histórico requiere una decisión explícita: marca la confirmación e indica el motivo (mínimo 10 caracteres).");
        return;
      }
    }
    const res = await fetch(`/api/empresas/${slug}/rrhh/vacaciones`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        empleadoId,
        fechaInicio,
        fechaFin,
        diasHabiles: diasNum,
        tipo,
        ...(plan?.requiereDecision && decisionAcepta ? { decision: { huella: plan.huella, motivo: decisionMotivo.trim() } } : {}),
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Error");
      return;
    }
    setDecisionAcepta(false);
    setDecisionMotivo("");
    setMsg(
      `${data.mensaje} · ${data.diasHabiles} día(s)` +
        (data.desglose?.length
          ? ` · FIFO: ${data.desglose.map((d: { diasTomados: number; periodoInicio: string }) => `${d.diasTomados}d ${fmtUi(d.periodoInicio)}`).join(", ")}`
          : ""),
    );
    await cargar();
  }

  async function confirmarEliminar() {
    if (!porEliminar) return;
    const fila = porEliminar as FilaHistorial;
    setEliminando(true);
    setErrorEliminar("");
    const r = await eliminarUnaVez(eliminandoRef, (u, i) => fetch(u, i), slug, Number(fila.id), tipoDescuentaSaldo(String(fila.tipo ?? "")));
    setEliminando(false);
    if (r === null) return; // ya había un DELETE en curso
    if (r.tipo === "error") {
      setErrorEliminar(r.error); // la fila se conserva
      return;
    }
    setPorEliminar(null);
    setError("");
    setMsg(r.mensaje + (r.advertencias.length ? ` ${r.advertencias.join(" ")}` : ""));
    await cargar(); // historial, saldo y períodos
  }

  const usaSaldo =
    tipo === "Vacaciones" || tipo === "A cuenta de Vacaciones";
  const input =
    "rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1 text-sm";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Vacaciones / En Ruta</h1>
          <p className="text-sm text-[var(--muted)]">
            15 días/periodo, FIFO. Doble clic en el historial para adjuntar
            boletas (PDF/fotos).
          </p>
        </div>
        <div className="flex gap-2">
          <span className="rounded bg-[var(--accent)] px-3 py-1.5 text-sm text-white">
            Vacaciones
          </span>
          <Link
            href={`/e/${slug}/rrhh/en-ruta`}
            className="rounded bg-[#334155] px-3 py-1.5 text-sm"
          >
            En Ruta →
          </Link>
        </div>
      </div>

      <ModoCargaHistoricaVacaciones
        slug={slug}
        puedeCambiar={puedeCambiarModo}
        onModo={setModoHistorico}
        onCambio={async () => { await cargar(); setVersionReparacion((v) => v + 1); }}
      />

      {aviso ? <p className="text-sm text-amber-300">{aviso}</p> : null}

      <VacacionesAlertasPanel slug={slug} />

      <SolicitudesVacacionesPanel slug={slug} onResuelto={() => void cargar()} />

      <form
        onSubmit={onSubmit}
        className="grid gap-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 sm:grid-cols-2 lg:grid-cols-3"
      >
        <EmpleadoPicker
          empleados={empleados}
          value={empleadoId}
          onChange={setEmpleadoId}
          className="sm:col-span-2 lg:col-span-1"
          inputClassName={input}
        />
        <label className="text-sm text-[var(--muted)]">
          Tipo
          <select
            className={`${input} mt-1 w-full`}
            value={tipo}
            onChange={(e) => setTipo(e.target.value as (typeof TIPOS)[number])}
          >
            {TIPOS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm text-[var(--muted)]">
          Días hábiles
          <input
            className={`${input} mt-1 w-full`}
            value={dias}
            onChange={(e) => setDias(e.target.value)}
          />
        </label>
        <label className="text-sm text-[var(--muted)]">
          Desde
          <input
            type="date"
            className={`${input} mt-1 w-full`}
            value={fechaInicio}
            onChange={(e) => setFechaInicio(e.target.value)}
          />
        </label>
        <label className="text-sm text-[var(--muted)]">
          Hasta
          <input
            type="date"
            className={`${input} mt-1 w-full`}
            value={fechaFin}
            onChange={(e) => setFechaFin(e.target.value)}
          />
        </label>
        <div className="flex items-end">
          <button className="rounded bg-[var(--accent)] px-4 py-2 text-sm text-white">
            {usaSaldo ? "Registrar (descuenta saldo)" : "Registrar permiso"}
          </button>
        </div>
      </form>

      {usaSaldo && previa ? (
        <PrevisualizacionHistorica
          previa={previa}
          decisionAcepta={decisionAcepta}
          onDecisionAcepta={setDecisionAcepta}
          decisionMotivo={decisionMotivo}
          onDecisionMotivo={setDecisionMotivo}
        />
      ) : null}

      {usaSaldo && saldo != null ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 text-sm">
          <p className="text-xs text-[var(--muted)]">
            {modoHistorico
              ? "El saldo se calcula desde la fecha de contratación / alta (no la entrada laboral). MODO DE CARGA HISTÓRICA: saldo TEMPORAL, sin el límite de 2 períodos / 30 días."
              : "El saldo se calcula desde la fecha de contratación / alta (no la entrada laboral). Máximo 2 periodos vigentes (30 días): al acumular el periodo actual, el excedente se descuenta del periodo más viejo (FIFO)."}
          </p>
          <p className="mt-1">
            Saldo disponible:{" "}
            <span className="font-semibold text-emerald-300">{saldo}</span>{" "}
            día(s)
          </p>
          <ul className="mt-2 space-y-1 text-[var(--muted)]">
            {periodos.map((p) => (
              <li key={p.id}>
                Año laboral {p.anioLaboral}: {p.diasDisponibles}/
                {p.diasOtorgados} · {fmtUi(p.periodoInicio)} →{" "}
                {fmtUi(p.periodoFin)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {puedeReparar ? <PendientesReparacionVacaciones slug={slug} version={versionReparacion} onRevisar={(id) => setEmpleadoId(id)} onLoteTerminado={async () => { await cargar(); setVersionReparacion((v) => v + 1); }} /> : null}

      {usaSaldo && historial ? (
        <HistorialPeriodosVacaciones
          historial={historial}
          admin
          modoCargaHistorica={modoHistorico}
          reparacion={puedeReparar && empleadoId ? { slug, empleadoId, onReparado: async () => { await cargar(); setVersionReparacion((v) => v + 1); } } : undefined}
        />
      ) : null}

      {puedeImportarHistorial ? <ExportarHistorialVacaciones slug={slug} /> : null}
      {puedeImportarHistorial ? <ImportarHistorialVacaciones slug={slug} /> : null}

      {error ? <p className="text-sm text-red-300">{error}</p> : null}
      {msg ? <p className="text-sm text-emerald-300">{msg}</p> : null}

      {/* RRHH-VACACIONES-FILTROS-HISTORIAL-1 — filtros del HISTORIAL, independientes del empleado/tipo del
          formulario de registro de arriba: cambiarlos nunca toca empleadoId/tipo/fechaInicio/fechaFin/dias. */}
      <div className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <h2 className="text-sm font-semibold text-[var(--muted)]">HISTORIAL DE VACACIONES</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <EmpleadoPicker
            empleados={empleados}
            value={filtroEmpleadoId}
            onChange={setFiltroEmpleadoId}
            inputClassName={input}
            label="Colaborador"
            emptyLabel="Todos los colaboradores"
            allowEmptySelection
          />
          <label className="text-sm text-[var(--muted)]">
            Tipo
            <select className={`${input} mt-1 w-full`} value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)}>
              <option value="">Todos los tipos</option>
              {TIPOS.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </label>
          <label className="text-sm text-[var(--muted)]">
            Desde
            <input type="date" className={`${input} mt-1 w-full`} value={filtroDesde} onChange={(e) => setFiltroDesde(e.target.value)} />
          </label>
          <label className="text-sm text-[var(--muted)]">
            Hasta
            <input type="date" className={`${input} mt-1 w-full`} value={filtroHasta} onChange={(e) => setFiltroHasta(e.target.value)} />
          </label>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-[var(--muted)]">
            Mostrando {rows.length} registro(s)
            {filtroEmpleadoId
              ? ` · Filtrado por: ${empleados.find((e) => e.id === filtroEmpleadoId)?.nombre ?? "colaborador seleccionado"}`
              : " · Todos los colaboradores"}
          </p>
          <button type="button" className="rounded border border-[var(--border)] px-3 py-1.5 text-sm" onClick={limpiarFiltrosHistorial}>
            Limpiar filtros
          </button>
        </div>
        {errorFiltros ? <p role="alert" className="text-sm text-red-300">{errorFiltros}</p> : null}
      </div>

      <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
        <table className="w-full text-left text-sm">
          <thead className="bg-[var(--thead)] text-[var(--muted)]">
            <tr>
              <th className="px-3 py-2">Empleado</th>
              <th className="px-3 py-2">Tipo</th>
              <th className="px-3 py-2">Desde</th>
              <th className="px-3 py-2">Hasta</th>
              <th className="px-3 py-2">Días</th>
              <th className="px-3 py-2">Evid.</th>
              {puedeEliminar ? <th className="px-3 py-2">Acciones</th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td className="px-3 py-3 text-[var(--muted)]" colSpan={puedeEliminar ? 7 : 6}>
                  No hay registros que coincidan con los filtros.
                </td>
              </tr>
            ) : null}
            {rows.map((r) => (
              <tr
                key={String(r.id)}
                className="cursor-pointer border-t border-[var(--border)] hover:bg-white/5"
                title="Doble clic: evidencias / boletas"
                onDoubleClick={() =>
                  setEvModal({
                    id: Number(r.id),
                    titulo: `${String(r.emp_codigo)} — ${String(r.tipo)} · ${fmtUi(String(r.fecha_inicio))} → ${fmtUi(String(r.fecha_fin))}`,
                  })
                }
              >
                <td className="px-3 py-2">
                  {String(r.emp_codigo)} — {String(r.emp_nombre ?? "")}
                </td>
                <td className="px-3 py-2">{String(r.tipo)}</td>
                <td className="px-3 py-2">{fmtUi(String(r.fecha_inicio))}</td>
                <td className="px-3 py-2">{fmtUi(String(r.fecha_fin))}</td>
                <td className="px-3 py-2">{String(r.dias_habiles)}</td>
                <td className="px-3 py-2">
                  <button
                    type="button"
                    className="text-[var(--accent-2)] underline"
                    onClick={() =>
                      setEvModal({
                        id: Number(r.id),
                        titulo: `${String(r.emp_codigo)} — ${String(r.tipo)}`,
                      })
                    }
                  >
                    📎 {Number(r.evidencias ?? 0)}
                  </button>
                </td>
                {puedeEliminar ? (
                  <td className="px-3 py-2">
                    {tipoEliminable(String(r.tipo)) ? (
                      <button
                        type="button"
                        className="text-red-300 underline disabled:opacity-40"
                        disabled={eliminando}
                        aria-label={`Eliminar registro de ${String(r.emp_nombre ?? r.emp_codigo)}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setErrorEliminar("");
                          setPorEliminar(r);
                        }}
                      >
                        Eliminar
                      </button>
                    ) : null}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {porEliminar ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="Eliminar registro de vacaciones">
          {(() => {
            const t = textoConfirmacion(porEliminar as FilaHistorial);
            return (
              <div className="w-full max-w-md space-y-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-5 text-sm">
                <h2 className="text-lg font-semibold">{t.titulo}</h2>
                <dl className="space-y-1">
                  <div><dt className="text-xs text-[var(--muted)]">Empleado</dt><dd>{t.empleado}</dd></div>
                  <div><dt className="text-xs text-[var(--muted)]">Periodo</dt><dd>{t.periodo}</dd></div>
                  <div><dt className="text-xs text-[var(--muted)]">Días</dt><dd>{t.dias}</dd></div>
                </dl>
                <p>{t.aviso}</p>
                {errorEliminar ? <p role="alert" className="text-red-300">{errorEliminar}</p> : null}
                <div className="flex justify-end gap-2">
                  <button type="button" className="rounded border border-[var(--border)] px-3 py-1.5" disabled={eliminando} onClick={() => setPorEliminar(null)}>
                    Cancelar
                  </button>
                  <button type="button" className="rounded bg-red-700 px-3 py-1.5 text-white disabled:opacity-50" disabled={eliminando} onClick={() => void confirmarEliminar()}>
                    {eliminando ? "Eliminando…" : t.botonConfirmar}
                  </button>
                </div>
              </div>
            );
          })()}
        </div>
      ) : null}

      {evModal ? (
        <EvidenciasModal
          slug={slug}
          incidenciaId={evModal.id}
          titulo={evModal.titulo}
          onClose={() => setEvModal(null)}
          onChanged={() => void cargar()}
        />
      ) : null}
    </div>
  );
}
