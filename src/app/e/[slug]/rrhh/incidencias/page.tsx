"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

type Emp = { id: number; codigo: string; nombre: string };

export default function IncidenciasPage() {
  const slug = String(useParams().slug);
  const [empleados, setEmpleados] = useState<Emp[]>([]);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [empleadoId, setEmpleadoId] = useState(0);
  const [tipo, setTipo] = useState("Permiso");
  const [fechaInicio, setFechaInicio] = useState(new Date().toISOString().slice(0, 10));
  const [fechaFin, setFechaFin] = useState(new Date().toISOString().slice(0, 10));
  const [diasHabiles, setDiasHabiles] = useState(1);
  const [msg, setMsg] = useState("");

  const cargar = useCallback(async () => {
    const [e, i] = await Promise.all([
      fetch(`/api/empresas/${slug}/empleados`).then((r) => r.json()),
      fetch(`/api/empresas/${slug}/rrhh/incidencias`).then((r) => r.json()),
    ]);
    setEmpleados(e.empleados ?? []);
    setRows(i.incidencias ?? []);
    if (!empleadoId && e.empleados?.[0]) setEmpleadoId(e.empleados[0].id);
  }, [slug, empleadoId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const res = await fetch(`/api/empresas/${slug}/rrhh/incidencias`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ empleadoId, tipo, fechaInicio, fechaFin, diasHabiles }),
    });
    const data = await res.json();
    setMsg(data.mensaje || data.error);
    if (res.ok) await cargar();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Incidencias</h1>
        <p className="text-sm text-[var(--muted)]">
          Permisos, faltas, etc.{" "}
          <Link href={`/e/${slug}/rrhh`} className="text-[var(--accent)] underline">RRHH</Link>
        </p>
      </div>
      <form onSubmit={onSubmit} className="flex flex-wrap gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <select className="rounded border border-[var(--border)] bg-[#0b1217] px-2 py-1" value={empleadoId} onChange={(e) => setEmpleadoId(Number(e.target.value))}>
          {empleados.map((e) => (
            <option key={e.id} value={e.id}>{e.codigo} — {e.nombre}</option>
          ))}
        </select>
        <select className="rounded border border-[var(--border)] bg-[#0b1217] px-2 py-1" value={tipo} onChange={(e) => setTipo(e.target.value)}>
          {["Permiso", "Falta", "Suspensión", "Otro"].map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
        <input type="date" className="rounded border border-[var(--border)] bg-[#0b1217] px-2 py-1" value={fechaInicio} onChange={(e) => setFechaInicio(e.target.value)} />
        <input type="date" className="rounded border border-[var(--border)] bg-[#0b1217] px-2 py-1" value={fechaFin} onChange={(e) => setFechaFin(e.target.value)} />
        <input type="number" className="w-20 rounded border border-[var(--border)] bg-[#0b1217] px-2 py-1" value={diasHabiles} onChange={(e) => setDiasHabiles(Number(e.target.value))} />
        <button className="rounded bg-[var(--accent)] px-3 py-1 text-sm text-white">Guardar</button>
      </form>
      {msg ? <p className="text-sm text-emerald-300">{msg}</p> : null}
      <ul className="space-y-1 text-sm">
        {rows.map((r) => (
          <li key={String(r.id)} className="rounded border border-[var(--border)] px-3 py-2">
            {String(r.emp_codigo)} — {String(r.tipo)} · {String(r.fecha_inicio).slice(0, 10)} → {String(r.fecha_fin).slice(0, 10)} ({String(r.dias_habiles)} d)
          </li>
        ))}
      </ul>
    </div>
  );
}
