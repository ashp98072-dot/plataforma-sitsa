"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useEmpresaSession } from "@/lib/empresa-session";
import type { AsistenciaDia, EmpleadoAsistencia, ResultadoCierre } from "@/lib/rrhh/asistencia-diaria";

type Dia = AsistenciaDia & { hoy: string };
type CierreOk = Extract<ResultadoCierre, { ok: true }>;

const ESTILO_ESTADO: Record<string, string> = {
  Presente: "text-emerald-300",
  "Marcaje existente": "text-emerald-300",
  Vacaciones: "text-sky-300",
  Justificado: "text-sky-300",
  "En ruta": "text-sky-300",
  "No aplica": "text-[var(--muted)]",
  "Requiere registro manual": "text-amber-300",
  Ausente: "text-rose-300",
  Pendiente: "text-[var(--text)]",
};

const fmtFecha = (f: string) => f.split("-").reverse().join("/");

/**
 * RRHH-TOMAR-ASISTENCIA-1 — RRHH > Marcajes > Tomar asistencia. Convive con
 * el kiosco (DPI + foto + GPS) y con la Corrección manual: no los reemplaza.
 * Los checkbox se guardan SOLO al "Cerrar asistencia del día" (nada se
 * escribe por cada clic); el servidor recalcula quién es elegible.
 */
export default function TomarAsistenciaPage() {
  const slug = String(useParams().slug);
  const { rol } = useEmpresaSession();
  const [fecha, setFecha] = useState("");
  const [dia, setDia] = useState<Dia | null>(null);
  const [seleccion, setSeleccion] = useState<Set<number>>(new Set());
  const [cargando, setCargando] = useState(true);
  const [procesando, setProcesando] = useState(false);
  const [error, setError] = useState("");
  const [cierre, setCierre] = useState<CierreOk | null>(null);

  const cargar = useCallback(async (f: string) => {
    setCargando(true);
    setError("");
    try {
      const res = await fetch(`/api/empresas/${slug}/rrhh/asistencia${f ? `?fecha=${encodeURIComponent(f)}` : ""}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "No se pudo cargar la asistencia."); return; }
      setDia(data);
      setFecha(data.fecha);
      setSeleccion(new Set());
    } catch {
      setError("Error de conexión.");
    } finally {
      setCargando(false);
    }
  }, [slug]);

  useEffect(() => {
    if (rol === "Marcaje") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void cargar("");
  }, [cargar, rol]);

  const empleados = useMemo(() => dia?.empleados ?? [], [dia]);
  const elegibles = useMemo(() => empleados.filter((e) => e.seleccionable), [empleados]);
  const justificados = empleados.filter((e) => ["Vacaciones", "Justificado", "En ruta"].includes(e.estado)).length;
  const yaPresentes = empleados.filter((e) => e.marcado).length;
  const seleccionados = elegibles.filter((e) => seleccion.has(e.id)).length;
  const pendientes = elegibles.length - seleccionados;

  if (rol === "Marcaje") {
    return <p role="alert" className="p-6">El kiosco de marcaje no puede tomar asistencia.</p>;
  }

  function alternar(e: EmpleadoAsistencia) {
    if (!e.seleccionable) return;
    setSeleccion((prev) => {
      const n = new Set(prev);
      if (n.has(e.id)) n.delete(e.id); else n.add(e.id);
      return n;
    });
  }

  async function cerrarDia() {
    if (!dia || procesando) return;
    const mensaje = `Se registrarán ${seleccionados} presentes y ${pendientes} ausencias. Las ausencias quedan CONFIRMADAS como falta injustificada y se descontarán en la planilla (sueldo base ÷ divisor).\nLos empleados con vacaciones/permisos/en ruta no serán marcados como falta.\n¿Continuar?`;
    if (!window.confirm(mensaje)) return;
    setProcesando(true);
    setError("");
    try {
      const res = await fetch(`/api/empresas/${slug}/rrhh/asistencia`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fecha: dia.fecha, empleadoIds: elegibles.filter((e) => seleccion.has(e.id)).map((e) => e.id) }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "No se pudo cerrar la asistencia."); return; }
      setCierre(data);
      await cargar(dia.fecha); // el servidor es la fuente de verdad: se recarga el estado real
    } catch {
      setError("Error de conexión.");
    } finally {
      setProcesando(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Tomar asistencia</h1>
          <p className="text-sm text-[var(--muted)]">Marca quién asistió y cierra el día. No reemplaza el kiosco ni la corrección manual.</p>
        </div>
        <Link href={`/e/${slug}/rrhh/marcajes`} className="text-sm underline">← Registrar marcaje</Link>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-[var(--muted)]">
          Fecha
          <input
            type="date"
            className="mt-1 block rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1.5 text-sm"
            value={fecha}
            max={dia?.hoy}
            onChange={(e) => { setCierre(null); void cargar(e.target.value); }}
          />
        </label>
        <button type="button" disabled={!elegibles.some((e) => e.estado === "Pendiente")} onClick={() => setSeleccion(new Set(elegibles.filter((e) => e.estado === "Pendiente").map((e) => e.id)))} className="rounded border border-[var(--border)] px-3 py-1.5 text-sm disabled:opacity-40">Marcar todos</button>
        <button type="button" disabled={!seleccion.size} onClick={() => setSeleccion(new Set())} className="rounded border border-[var(--border)] px-3 py-1.5 text-sm disabled:opacity-40">Desmarcar todos</button>
        <button type="button" disabled={procesando || cargando || !dia?.laborable || Boolean(dia?.bloqueo)} onClick={() => void cerrarDia()} className="rounded bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">
          {procesando ? "Cerrando…" : "Cerrar asistencia del día"}
        </button>
      </div>

      <p className="text-sm" aria-live="polite">
        Presentes seleccionados: <strong>{seleccionados}</strong> · Ya presentes: <strong>{yaPresentes}</strong> · Justificados: <strong>{justificados}</strong> · Pendientes/Ausentes: <strong>{pendientes}</strong>
      </p>
      {dia && !dia.laborable ? <p className="text-sm text-amber-300">La fecha no es día laborable (domingo o feriado): no aplica tomar asistencia.</p> : null}
      {dia?.bloqueo ? <p role="alert" className="text-sm text-amber-300">{dia.bloqueo}</p> : null}
      {dia?.cierre ? <p className="text-sm text-emerald-300">Asistencia de este día cerrada por {dia.cierre.cerradoPor}. Para corregir a alguien marcado como ausente, márcalo y vuelve a cerrar.</p> : dia?.laborable ? <p className="text-sm text-[var(--muted)]">Día pendiente: aún no se ha cerrado la asistencia.</p> : null}
      {error ? <p role="alert" className="text-sm text-rose-300">{error}</p> : null}

      {cierre ? (
        <section aria-label="Resumen del cierre" className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 text-sm">
          <h2 className="font-semibold">Asistencia del {fmtFecha(cierre.fecha)}</h2>
          <p>Presentes: {cierre.resumen.presentes} · Vacaciones: {cierre.resumen.vacaciones} · Permisos: {cierre.resumen.permisos} · Ausentes: {cierre.resumen.ausentes}</p>
          <p className="text-[var(--muted)]">Jornadas administrativas creadas ahora: {cierre.creados}. Ausencias confirmadas: {cierre.ausenciasConfirmadas}{cierre.ausenciasAnuladas ? ` (anuladas por corrección: ${cierre.ausenciasAnuladas})` : ""}. Con marcaje existente: {cierre.yaRegistrados}.{cierre.resumen.enRuta ? ` En ruta: ${cierre.resumen.enRuta}.` : ""}{cierre.resumen.requiereManual ? ` Requieren registro manual: ${cierre.resumen.requiereManual}.` : ""}</p>
        </section>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
        <table className="w-full text-left text-sm">
          <thead className="bg-[var(--card)] text-xs text-[var(--muted)]">
            <tr>
              <th className="px-3 py-2">Asistió</th>
              <th className="px-3 py-2">Código</th>
              <th className="px-3 py-2">Nombre</th>
              <th className="px-3 py-2">Puesto</th>
              <th className="px-3 py-2">Horario</th>
              <th className="px-3 py-2">Estado del día</th>
              <th className="px-3 py-2">Observación</th>
            </tr>
          </thead>
          <tbody>
            {cargando ? (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-[var(--muted)]">Cargando…</td></tr>
            ) : !empleados.length ? (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-[var(--muted)]">No hay empleados activos para esta fecha.</td></tr>
            ) : empleados.map((e) => (
              <tr key={e.id} className="border-t border-[var(--border)]">
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    aria-label={`Asistió: ${e.nombre}`}
                    checked={e.marcado || seleccion.has(e.id)}
                    disabled={!e.seleccionable}
                    onChange={() => alternar(e)}
                  />
                </td>
                <td className="px-3 py-2 font-mono">{e.codigo}</td>
                <td className="px-3 py-2">{e.nombre}</td>
                <td className="px-3 py-2">{e.puesto || "—"}</td>
                <td className="px-3 py-2">{e.horario.entrada && e.horario.salida ? `${e.horario.entrada.slice(0, 5)} - ${e.horario.salida.slice(0, 5)}` : e.horario.tipo}</td>
                <td className={`px-3 py-2 ${ESTILO_ESTADO[e.estado] ?? ""}`}>{e.marcado ? `✓ ${e.estado}` : e.estado}</td>
                <td className="px-3 py-2 text-[var(--muted)]">{e.detalle}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
