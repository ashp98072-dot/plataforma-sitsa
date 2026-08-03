"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

type Emp = { id: number; codigo: string; nombre: string };

export default function VacacionesPage() {
  const slug = String(useParams().slug);
  const [empleados, setEmpleados] = useState<Emp[]>([]);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [empleadoId, setEmpleadoId] = useState(0);
  const [fechaInicio, setFechaInicio] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [fechaFin, setFechaFin] = useState(new Date().toISOString().slice(0, 10));
  const [observaciones, setObservaciones] = useState("");
  const [msg, setMsg] = useState("");

  const cargar = useCallback(async () => {
    const [e, v] = await Promise.all([
      fetch(`/api/empresas/${slug}/empleados`).then((r) => r.json()),
      fetch(`/api/empresas/${slug}/rrhh/vacaciones`).then((r) => r.json()),
    ]);
    setEmpleados(e.empleados ?? []);
    setRows(v.vacaciones ?? []);
    if (!empleadoId && e.empleados?.[0]) setEmpleadoId(e.empleados[0].id);
  }, [slug, empleadoId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const res = await fetch(`/api/empresas/${slug}/rrhh/vacaciones`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ empleadoId, fechaInicio, fechaFin, observaciones }),
    });
    const data = await res.json();
    setMsg(data.mensaje || data.error);
    if (res.ok) await cargar();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Vacaciones</h1>
        <p className="text-sm text-[var(--muted)]">
          Registro por empresa.{" "}
          <Link href={`/e/${slug}/rrhh`} className="text-[var(--accent)] underline">
            RRHH
          </Link>
        </p>
      </div>
      <form onSubmit={onSubmit} className="grid gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 md:grid-cols-2">
        <select className="rounded border border-[var(--border)] bg-[#0b1217] px-2 py-1" value={empleadoId} onChange={(e) => setEmpleadoId(Number(e.target.value))}>
          {empleados.map((e) => (
            <option key={e.id} value={e.id}>{e.codigo} — {e.nombre}</option>
          ))}
        </select>
        <input type="date" className="rounded border border-[var(--border)] bg-[#0b1217] px-2 py-1" value={fechaInicio} onChange={(e) => setFechaInicio(e.target.value)} />
        <input type="date" className="rounded border border-[var(--border)] bg-[#0b1217] px-2 py-1" value={fechaFin} onChange={(e) => setFechaFin(e.target.value)} />
        <input className="rounded border border-[var(--border)] bg-[#0b1217] px-2 py-1" placeholder="Observaciones" value={observaciones} onChange={(e) => setObservaciones(e.target.value)} />
        <button className="rounded bg-[var(--accent)] px-3 py-1 text-sm text-white">Registrar</button>
      </form>
      {msg ? <p className="text-sm text-emerald-300">{msg}</p> : null}
      <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-[#1F6AA5] text-white">
            <tr>
              <th className="px-3 py-2">Empleado</th>
              <th className="px-3 py-2">Inicio</th>
              <th className="px-3 py-2">Fin</th>
              <th className="px-3 py-2">Días hábiles</th>
              <th className="px-3 py-2">Estado</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={String(r.id)} className="border-t border-[var(--border)]">
                <td className="px-3 py-2">{String(r.emp_codigo)} — {String(r.emp_nombre)}</td>
                <td className="px-3 py-2">{String(r.fecha_inicio).slice(0, 10)}</td>
                <td className="px-3 py-2">{String(r.fecha_fin).slice(0, 10)}</td>
                <td className="px-3 py-2">{String(r.dias_habiles)}</td>
                <td className="px-3 py-2">{String(r.estado)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
