"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

type Emp = { id: number; codigo: string; nombre: string };
type Resumen = {
  codigo: string;
  empleado: string;
  totalRetrasos: number;
  totalSalidasTempranas: number;
  totalFaltas: number;
  totalDiasAsistidos: number;
};

const TIPOS = [
  "Vacaciones",
  "Permiso con goce",
  "Permiso sin goce",
  "IGSS",
  "Médico",
  "Fallecimiento de Familiar",
  "Nacimiento de Hijo",
  "Enfermedad",
  "Sin Goce de Salario",
  "Matrimonio",
  "Citaciones Judiciales",
  "A cuenta de Vacaciones",
  "Cumpleaños",
  "Falta",
  "Suspensión",
  "Otro",
];

export default function IncidenciasPage() {
  const slug = String(useParams().slug);
  const [tab, setTab] = useState<"registro" | "resumen">("registro");
  const [empleados, setEmpleados] = useState<Emp[]>([]);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [resumen, setResumen] = useState<Resumen[]>([]);
  const [empleadoId, setEmpleadoId] = useState(0);
  const [tipo, setTipo] = useState("Permiso con goce");
  const [fechaInicio, setFechaInicio] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [fechaFin, setFechaFin] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [periodo, setPeriodo] = useState("Mes actual");
  const [msg, setMsg] = useState("");

  const cargar = useCallback(async () => {
    const e = await fetch(`/api/empresas/${slug}/empleados`).then((r) =>
      r.json(),
    );
    setEmpleados(e.empleados ?? []);
    if (!empleadoId && e.empleados?.[0]) setEmpleadoId(e.empleados[0].id);

    if (tab === "registro") {
      const i = await fetch(`/api/empresas/${slug}/rrhh/incidencias`).then(
        (r) => r.json(),
      );
      setRows(i.incidencias ?? []);
    } else {
      const qs = new URLSearchParams({
        modo: "incidencias",
        periodo,
      });
      const r = await fetch(`/api/empresas/${slug}/rrhh/reportes?${qs}`).then(
        (x) => x.json(),
      );
      setResumen(r.resumen ?? []);
    }
  }, [slug, tab, periodo, empleadoId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const res = await fetch(`/api/empresas/${slug}/rrhh/incidencias`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        empleadoId,
        tipo,
        fechaInicio,
        fechaFin,
        diasHabiles: 1,
      }),
    });
    const data = await res.json();
    setMsg(data.mensaje || data.error);
    if (res.ok) await cargar();
  }

  const input =
    "rounded border border-[var(--border)] bg-[#0b1217] px-2 py-1 text-sm";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Incidencias</h1>
        <p className="text-sm text-[var(--muted)]">
          Registro de permisos y resumen operativo (retrasos/faltas) como en
          Control de Asistencias.{" "}
          <Link
            href={`/e/${slug}/rrhh/reportes`}
            className="text-[var(--accent)] underline"
          >
            Reportes
          </Link>
        </p>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          className={`rounded px-3 py-1 text-sm ${tab === "registro" ? "bg-[var(--accent)] text-white" : "bg-[#334155]"}`}
          onClick={() => setTab("registro")}
        >
          Registrar
        </button>
        <button
          type="button"
          className={`rounded px-3 py-1 text-sm ${tab === "resumen" ? "bg-[var(--accent)] text-white" : "bg-[#334155]"}`}
          onClick={() => setTab("resumen")}
        >
          Resumen operativo
        </button>
      </div>

      {tab === "registro" ? (
        <>
          <form
            onSubmit={onSubmit}
            className="flex flex-wrap gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4"
          >
            <select
              className={input}
              value={empleadoId}
              onChange={(e) => setEmpleadoId(Number(e.target.value))}
            >
              {empleados.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.codigo} — {e.nombre}
                </option>
              ))}
            </select>
            <select
              className={input}
              value={tipo}
              onChange={(e) => setTipo(e.target.value)}
            >
              {TIPOS.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
            <input
              type="date"
              className={input}
              value={fechaInicio}
              onChange={(e) => setFechaInicio(e.target.value)}
            />
            <input
              type="date"
              className={input}
              value={fechaFin}
              onChange={(e) => setFechaFin(e.target.value)}
            />
            <button className="rounded bg-[var(--accent)] px-3 py-1 text-sm text-white">
              Guardar
            </button>
          </form>
          {msg ? <p className="text-sm text-emerald-300">{msg}</p> : null}
          <ul className="space-y-1 text-sm">
            {rows.map((r) => (
              <li
                key={String(r.id)}
                className="rounded border border-[var(--border)] px-3 py-2"
              >
                {String(r.emp_codigo)} — {String(r.tipo)} ·{" "}
                {String(r.fecha_inicio).slice(0, 10)} →{" "}
                {String(r.fecha_fin).slice(0, 10)}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          <div className="flex gap-2">
            <select
              className={input}
              value={periodo}
              onChange={(e) => setPeriodo(e.target.value)}
            >
              {[
                "Hoy",
                "Últimos 7 días",
                "Mes actual",
                "Quincena 1 (día 1 al 15)",
                "Quincena 2 (día 16 al fin de mes)",
              ].map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
            <button
              type="button"
              className="rounded bg-[#0d9488] px-3 py-1 text-sm text-white"
              onClick={() =>
                window.open(
                  `/api/empresas/${slug}/rrhh/reportes?modo=incidencias&periodo=${encodeURIComponent(periodo)}&formato=xlsx`,
                  "_blank",
                )
              }
            >
              Excel
            </button>
            <button
              type="button"
              className="rounded bg-[#1e293b] px-3 py-1 text-sm"
              onClick={() =>
                window.open(
                  `/api/empresas/${slug}/rrhh/reportes?modo=incidencias&periodo=${encodeURIComponent(periodo)}&formato=pdf`,
                  "_blank",
                )
              }
            >
              PDF
            </button>
          </div>
          <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
            <table className="w-full text-left text-sm">
              <thead className="bg-[#0d1522] text-[var(--muted)]">
                <tr>
                  <th className="px-3 py-2">Código</th>
                  <th className="px-3 py-2">Empleado</th>
                  <th className="px-3 py-2">Retrasos</th>
                  <th className="px-3 py-2">Sal. tempranas</th>
                  <th className="px-3 py-2">Faltas</th>
                  <th className="px-3 py-2">Días asistidos</th>
                </tr>
              </thead>
              <tbody>
                {resumen.map((r) => (
                  <tr
                    key={r.codigo}
                    className="border-t border-[var(--border)]"
                  >
                    <td className="px-3 py-2">{r.codigo}</td>
                    <td className="px-3 py-2">{r.empleado}</td>
                    <td className="px-3 py-2">{r.totalRetrasos}</td>
                    <td className="px-3 py-2">{r.totalSalidasTempranas}</td>
                    <td className="px-3 py-2">{r.totalFaltas}</td>
                    <td className="px-3 py-2">{r.totalDiasAsistidos}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
