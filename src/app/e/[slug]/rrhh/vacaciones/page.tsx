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
  type FilaHistorial,
} from "@/lib/rrhh/vacaciones-eliminar-ui";
import { SolicitudesVacacionesPanel } from "@/components/rrhh/solicitudes-vacaciones-panel";
import { VacacionesAlertasPanel } from "@/components/rrhh/vacaciones-alertas-panel";

type Emp = { id: number; codigo: string; nombre: string; dpi?: string };
type Periodo = {
  id: number;
  anioLaboral: number;
  periodoInicio: string;
  periodoFin: string;
  diasOtorgados: number;
  diasDisponibles: number;
};

const TIPOS = [
  "Vacaciones",
  "A cuenta de Vacaciones",
  "Permiso con goce",
  "Permiso sin goce",
  "IGSS",
  "Médico",
] as const;

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
  const [empleados, setEmpleados] = useState<Emp[]>([]);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [empleadoId, setEmpleadoId] = useState(0);
  const [tipo, setTipo] = useState<(typeof TIPOS)[number]>("Vacaciones");
  const [saldo, setSaldo] = useState<number | null>(null);
  const [periodos, setPeriodos] = useState<Periodo[]>([]);
  const [aviso, setAviso] = useState("");
  const [fechaInicio, setFechaInicio] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [fechaFin, setFechaFin] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [dias, setDias] = useState("1");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [evModal, setEvModal] = useState<{
    id: number;
    titulo: string;
  } | null>(null);
  // Eliminar registro: confirmación explícita, candado contra doble clic y errores que conservan la fila.
  const [porEliminar, setPorEliminar] = useState<Record<string, unknown> | null>(null);
  const [eliminando, setEliminando] = useState(false);
  const [errorEliminar, setErrorEliminar] = useState("");
  const eliminandoRef = useRef(false);

  const cargar = useCallback(async () => {
    const e = await fetch(`/api/empresas/${slug}/empleados`).then((r) =>
      r.json(),
    );
    setEmpleados(e.empleados ?? []);
    const id = empleadoId || e.empleados?.[0]?.id || 0;
    if (!empleadoId && id) setEmpleadoId(id);
    const qs = id ? `?empleadoId=${id}` : "";
    const v = await fetch(`/api/empresas/${slug}/rrhh/vacaciones${qs}`).then(
      (r) => r.json(),
    );
    setRows(v.vacaciones ?? []);
    setSaldo(v.saldo ?? null);
    setPeriodos(v.periodos ?? []);
    setAviso(v.aviso ?? "");
  }, [slug, empleadoId]);

  useEffect(() => {
    const inicio = window.setTimeout(() => void cargar(), 0);
    return () => window.clearTimeout(inicio);
  }, [cargar]);

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

  async function onSubmit(ev: FormEvent) {
    ev.preventDefault();
    setError("");
    setMsg("");
    const diasNum = Number(dias);
    if (!Number.isFinite(diasNum) || diasNum <= 0) {
      setError("Días hábiles inválidos.");
      return;
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
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Error");
      return;
    }
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

      {usaSaldo && saldo != null ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 text-sm">
          <p className="text-xs text-[var(--muted)]">
            El saldo se calcula desde la fecha de contratación / alta (no la
            entrada laboral). Máximo 2 periodos vigentes (30 días): al acumular
            el periodo actual, el excedente se descuenta del periodo más viejo
            (FIFO).
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

      {error ? <p className="text-sm text-red-300">{error}</p> : null}
      {msg ? <p className="text-sm text-emerald-300">{msg}</p> : null}

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
