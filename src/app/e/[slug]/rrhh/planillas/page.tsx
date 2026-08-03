"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

type Planilla = {
  id: number;
  codigo: string;
  fecha_inicio: string;
  fecha_fin: string;
  estado: string;
  notas: string | null;
};

export default function PlanillasPage() {
  const slug = String(useParams().slug);
  const [rows, setRows] = useState<Planilla[]>([]);
  const [empleadosActivos, setEmpleadosActivos] = useState(0);
  const [aviso, setAviso] = useState("");
  const [codigo, setCodigo] = useState("");
  const [fechaInicio, setFechaInicio] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [fechaFin, setFechaFin] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [notas, setNotas] = useState("");
  const [msg, setMsg] = useState("");

  const cargar = useCallback(async () => {
    const res = await fetch(`/api/empresas/${slug}/rrhh/planillas`);
    const data = await res.json();
    setRows(data.planillas ?? []);
    setEmpleadosActivos(Number(data.empleadosActivos ?? 0));
    setAviso(data.aviso ?? "");
  }, [slug]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const res = await fetch(`/api/empresas/${slug}/rrhh/planillas`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ codigo, fechaInicio, fechaFin, notas }),
    });
    const data = await res.json();
    setMsg(data.mensaje || data.error);
    if (res.ok) {
      setCodigo("");
      setNotas("");
      await cargar();
    }
  }

  const input =
    "rounded border border-[var(--border)] bg-[#0b1217] px-2 py-1 text-sm";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Planillas</h1>
        <p className="text-sm text-[var(--muted)]">
          Periodos de nómina (borrador). Empleados activos: {empleadosActivos}.{" "}
          <Link href={`/e/${slug}/dashboard-rrhh`} className="text-[var(--accent)] underline">
            Dashboard RRHH
          </Link>
        </p>
      </div>
      {aviso ? <p className="text-sm text-amber-300">{aviso}</p> : null}
      <form
        onSubmit={onSubmit}
        className="flex flex-wrap gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4"
      >
        <input
          className={input}
          placeholder="Código (ej. 2026-08-Q1)"
          value={codigo}
          onChange={(e) => setCodigo(e.target.value)}
          required
        />
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
        <input
          className={`${input} min-w-[12rem]`}
          placeholder="Notas"
          value={notas}
          onChange={(e) => setNotas(e.target.value)}
        />
        <button className="rounded bg-[var(--accent)] px-3 py-1 text-sm text-white">
          Crear periodo
        </button>
      </form>
      {msg ? <p className="text-sm text-emerald-300">{msg}</p> : null}
      <ul className="space-y-1 text-sm">
        {rows.map((r) => (
          <li
            key={r.id}
            className="rounded border border-[var(--border)] px-3 py-2"
          >
            <span className="font-medium">{r.codigo}</span> ·{" "}
            {String(r.fecha_inicio).slice(0, 10)} →{" "}
            {String(r.fecha_fin).slice(0, 10)} · {r.estado}
            {r.notas ? (
              <span className="text-[var(--muted)]"> — {r.notas}</span>
            ) : null}
          </li>
        ))}
        {!rows.length ? (
          <li className="text-[var(--muted)]">Sin periodos aún.</li>
        ) : null}
      </ul>
    </div>
  );
}
