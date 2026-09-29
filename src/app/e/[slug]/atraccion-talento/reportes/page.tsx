"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { EmpleadoPicker, type EmpOpt } from "@/components/rrhh/empleado-picker";

type Resumen = {
  total: number;
  programadas: number;
  realizadas: number;
  canceladas: number;
  noAsistio: number;
  aprobados: number;
  rechazados: number;
  pendientes: number;
  tasaAprobacion: number | null;
};
type PorPuesto = {
  puesto: string;
  entrevistas: number;
  realizadas: number;
  aprobados: number;
  rechazados: number;
  pendientes: number;
  tasaAprobacion: number | null;
};
type PorEntrevistador = {
  entrevistadorEmpleadoId: number | null;
  entrevistadorNombre: string;
  asignadas: number;
  realizadas: number;
  aprobados: number;
  rechazados: number;
  pendientes: number;
};
type DetalleFila = {
  id: number;
  fechaHora: string;
  candidatoNombre: string;
  puesto: string;
  entrevistadorNombre: string | null;
  modalidad: string;
  estado: string;
  resultado: string;
};
type Reporte = { resumen: Resumen; porPuesto: PorPuesto[]; porEntrevistador: PorEntrevistador[]; detalle: DetalleFila[] };

const RESUMEN_VACIO: Resumen = {
  total: 0, programadas: 0, realizadas: 0, canceladas: 0, noAsistio: 0,
  aprobados: 0, rechazados: 0, pendientes: 0, tasaAprobacion: null,
};

function primerDiaMes(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}
function ultimoDiaMes(): string {
  const d = new Date();
  const ultimo = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(ultimo).padStart(2, "0")}`;
}
function fmtTasa(t: number | null): string {
  return t == null ? "—" : `${t}%`;
}
function fmtFechaHora(iso: string): string {
  return iso.replace("T", " ").slice(0, 16);
}

const input = "rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1.5 text-sm";
const card = "rounded-xl border border-[var(--border)] bg-[var(--card)] p-4";

export default function ReportesAtraccionTalentoPage() {
  const slug = String(useParams().slug);
  const [fechaDesde, setFechaDesde] = useState(primerDiaMes());
  const [fechaHasta, setFechaHasta] = useState(ultimoDiaMes());
  const [puesto, setPuesto] = useState("");
  const [estado, setEstado] = useState("");
  const [resultado, setResultado] = useState("");
  const [entrevistadorId, setEntrevistadorId] = useState(0);
  const [empleados, setEmpleados] = useState<EmpOpt[]>([]);
  const [reporte, setReporte] = useState<Reporte>({ resumen: RESUMEN_VACIO, porPuesto: [], porEntrevistador: [], detalle: [] });
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void (async () => {
      const res = await fetch(`/api/empresas/${slug}/empleados?estado=Activo`);
      const data = await res.json().catch(() => ({}));
      if (res.ok) setEmpleados(data.empleados ?? []);
    })();
  }, [slug]);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (fechaDesde) params.set("fechaDesde", fechaDesde);
      if (fechaHasta) params.set("fechaHasta", fechaHasta);
      if (puesto.trim()) params.set("puesto", puesto.trim());
      if (estado) params.set("estado", estado);
      if (resultado) params.set("resultado", resultado);
      if (entrevistadorId) params.set("entrevistadorEmpleadoId", String(entrevistadorId));
      const res = await fetch(`/api/empresas/${slug}/rrhh/entrevistas/reportes?${params.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "No se pudo cargar el reporte.");
        return;
      }
      setReporte(data);
    } catch {
      setError("Error de conexión.");
    } finally {
      setCargando(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void cargar();
    // Carga inicial (mes actual) — los cambios posteriores de filtro solo aplican al pulsar "Actualizar".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { resumen, porPuesto, porEntrevistador, detalle } = reporte;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Reportes de Atracción de Talento Humano</h1>
        <p className="text-sm text-[var(--muted)]">
          Candidatos, entrevistas y resultados de selección — no incluye planillas ni otros reportes de RRHH.
        </p>
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); void cargar(); }}
        className={`${card} grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4`}
      >
        <label className="text-sm text-[var(--muted)]">Fecha desde
          <input type="date" className={`${input} mt-1 w-full`} value={fechaDesde} onChange={(e) => setFechaDesde(e.target.value)} />
        </label>
        <label className="text-sm text-[var(--muted)]">Fecha hasta
          <input type="date" className={`${input} mt-1 w-full`} value={fechaHasta} onChange={(e) => setFechaHasta(e.target.value)} />
        </label>
        <label className="text-sm text-[var(--muted)]">Puesto
          <input className={`${input} mt-1 w-full`} placeholder="Todos" value={puesto} onChange={(e) => setPuesto(e.target.value)} />
        </label>
        <label className="text-sm text-[var(--muted)]">Estado
          <select className={`${input} mt-1 w-full`} value={estado} onChange={(e) => setEstado(e.target.value)}>
            <option value="">Todos</option>
            <option value="Programada">Programada</option>
            <option value="Realizada">Realizada</option>
            <option value="Cancelada">Cancelada</option>
            <option value="No asistió">No asistió</option>
          </select>
        </label>
        <label className="text-sm text-[var(--muted)]">Resultado
          <select className={`${input} mt-1 w-full`} value={resultado} onChange={(e) => setResultado(e.target.value)}>
            <option value="">Todos</option>
            <option value="Pendiente">Pendiente</option>
            <option value="Aprobado">Aprobado</option>
            <option value="Rechazado">Rechazado</option>
          </select>
        </label>
        <div className="sm:col-span-2 lg:col-span-2">
          <EmpleadoPicker empleados={empleados} value={entrevistadorId} onChange={setEntrevistadorId} label="Entrevistador" />
        </div>
        <div className="flex items-end">
          <button className="rounded bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50" disabled={cargando}>
            {cargando ? "Actualizando…" : "Actualizar"}
          </button>
        </div>
      </form>

      {error ? <p className="text-sm text-red-400">{error}</p> : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
        {[
          ["Total", resumen.total],
          ["Programadas", resumen.programadas],
          ["Realizadas", resumen.realizadas],
          ["Canceladas", resumen.canceladas],
          ["No asistió", resumen.noAsistio],
          ["Aprobados", resumen.aprobados],
          ["Rechazados", resumen.rechazados],
          ["Resultado pendiente", resumen.pendientes],
        ].map(([label, val]) => (
          <div key={label as string} className={card}>
            <p className="text-xs text-[var(--muted)]">{label}</p>
            <p className="mt-1 text-xl font-semibold">{val}</p>
          </div>
        ))}
        <div className={card}>
          <p className="text-xs text-[var(--muted)]">Tasa de aprobación</p>
          <p className="mt-1 text-xl font-semibold">{fmtTasa(resumen.tasaAprobacion)}</p>
        </div>
      </div>

      <section className={card}>
        <h2 className="mb-2 text-sm font-semibold text-[var(--muted)]">POR PUESTO</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-[var(--muted)]">
              <tr>
                <th className="px-2 py-1">Puesto</th>
                <th className="px-2 py-1 text-right">Entrevistas</th>
                <th className="px-2 py-1 text-right">Realizadas</th>
                <th className="px-2 py-1 text-right">Aprobados</th>
                <th className="px-2 py-1 text-right">Rechazados</th>
                <th className="px-2 py-1 text-right">Pendientes</th>
                <th className="px-2 py-1 text-right">Tasa de aprobación</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {porPuesto.map((p) => (
                <tr key={p.puesto}>
                  <td className="px-2 py-1.5">{p.puesto}</td>
                  <td className="px-2 py-1.5 text-right">{p.entrevistas}</td>
                  <td className="px-2 py-1.5 text-right">{p.realizadas}</td>
                  <td className="px-2 py-1.5 text-right">{p.aprobados}</td>
                  <td className="px-2 py-1.5 text-right">{p.rechazados}</td>
                  <td className="px-2 py-1.5 text-right">{p.pendientes}</td>
                  <td className="px-2 py-1.5 text-right">{fmtTasa(p.tasaAprobacion)}</td>
                </tr>
              ))}
              {porPuesto.length === 0 ? (
                <tr><td colSpan={7} className="px-2 py-4 text-center text-[var(--muted)]">Sin datos en el rango filtrado.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className={card}>
        <h2 className="mb-2 text-sm font-semibold text-[var(--muted)]">POR ENTREVISTADOR</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-[var(--muted)]">
              <tr>
                <th className="px-2 py-1">Entrevistador</th>
                <th className="px-2 py-1 text-right">Asignadas</th>
                <th className="px-2 py-1 text-right">Realizadas</th>
                <th className="px-2 py-1 text-right">Aprobados</th>
                <th className="px-2 py-1 text-right">Rechazados</th>
                <th className="px-2 py-1 text-right">Pendientes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {porEntrevistador.map((p) => (
                <tr key={p.entrevistadorEmpleadoId ?? "sin-entrevistador"}>
                  <td className="px-2 py-1.5">{p.entrevistadorNombre}</td>
                  <td className="px-2 py-1.5 text-right">{p.asignadas}</td>
                  <td className="px-2 py-1.5 text-right">{p.realizadas}</td>
                  <td className="px-2 py-1.5 text-right">{p.aprobados}</td>
                  <td className="px-2 py-1.5 text-right">{p.rechazados}</td>
                  <td className="px-2 py-1.5 text-right">{p.pendientes}</td>
                </tr>
              ))}
              {porEntrevistador.length === 0 ? (
                <tr><td colSpan={6} className="px-2 py-4 text-center text-[var(--muted)]">Sin datos en el rango filtrado.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className={card}>
        <h2 className="mb-2 text-sm font-semibold text-[var(--muted)]">LISTADO DETALLADO</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-[var(--muted)]">
              <tr>
                <th className="px-2 py-1">Fecha</th>
                <th className="px-2 py-1">Candidato</th>
                <th className="px-2 py-1">Puesto</th>
                <th className="px-2 py-1">Entrevistador</th>
                <th className="px-2 py-1">Modalidad</th>
                <th className="px-2 py-1">Estado</th>
                <th className="px-2 py-1">Resultado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {detalle.map((d) => (
                <tr key={d.id}>
                  <td className="px-2 py-1.5">{fmtFechaHora(d.fechaHora)}</td>
                  <td className="px-2 py-1.5">{d.candidatoNombre}</td>
                  <td className="px-2 py-1.5">{d.puesto}</td>
                  <td className="px-2 py-1.5">{d.entrevistadorNombre ?? "—"}</td>
                  <td className="px-2 py-1.5">{d.modalidad}</td>
                  <td className="px-2 py-1.5">{d.estado}</td>
                  <td className="px-2 py-1.5">{d.resultado}</td>
                </tr>
              ))}
              {detalle.length === 0 ? (
                <tr><td colSpan={7} className="px-2 py-4 text-center text-[var(--muted)]">Sin entrevistas en el rango filtrado.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
