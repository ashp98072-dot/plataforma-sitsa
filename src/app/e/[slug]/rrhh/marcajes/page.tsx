"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useEmpresaActiva } from "@/lib/use-empresa-activa";

type Emp = { id: number; codigo: string; nombre: string };
type Marcaje = {
  id: number;
  fecha_jornada: string;
  entrada_at: string | null;
  salida_at: string | null;
  estado: string | null;
  emp_codigo: string;
  emp_nombre: string;
};

export default function MarcajesPage() {
  const { slug, nombre: empresaNombre } = useEmpresaActiva();
  const [empleados, setEmpleados] = useState<Emp[]>([]);
  const [marcajes, setMarcajes] = useState<Marcaje[]>([]);
  const [empleadoId, setEmpleadoId] = useState(0);
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10));
  const [msg, setMsg] = useState("");

  const cargar = useCallback(async () => {
    const [e, m] = await Promise.all([
      fetch(`/api/empresas/${slug}/empleados`).then((r) => r.json()),
      fetch(
        `/api/empresas/${slug}/rrhh/marcajes?desde=${fecha}&hasta=${fecha}`,
      ).then((r) => r.json()),
    ]);
    setEmpleados(e.empleados ?? []);
    setMarcajes(m.marcajes ?? []);
    if (!empleadoId && e.empleados?.[0]) setEmpleadoId(e.empleados[0].id);
  }, [slug, fecha, empleadoId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function marcar(tipo: "entrada" | "salida") {
    setMsg("");
    const res = await fetch(`/api/empresas/${slug}/rrhh/marcajes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        empleadoId,
        fechaJornada: fecha,
        tipo,
      }),
    });
    const data = await res.json();
    setMsg(data.mensaje || data.error);
    if (res.ok) await cargar();
  }

  async function onFilter(e: FormEvent) {
    e.preventDefault();
    await cargar();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">
          Marcajes · {empresaNombre}
        </h1>
        <p className="text-sm text-[var(--muted)]">
          Control de asistencias de esta empresa.{" "}
          <Link href={`/e/${slug}/rrhh`} className="text-[var(--accent)] underline">
            Volver a empleados
          </Link>
        </p>
      </div>

      <form
        onSubmit={onFilter}
        className="flex flex-wrap items-end gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4"
      >
        <label className="text-sm text-[var(--muted)]">
          Empleado
          <select
            className="mt-1 block rounded border border-[var(--border)] bg-[#0b1217] px-2 py-1"
            value={empleadoId}
            onChange={(e) => setEmpleadoId(Number(e.target.value))}
          >
            {empleados.map((e) => (
              <option key={e.id} value={e.id}>
                {e.codigo} — {e.nombre}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm text-[var(--muted)]">
          Fecha
          <input
            type="date"
            className="mt-1 block rounded border border-[var(--border)] bg-[#0b1217] px-2 py-1"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
          />
        </label>
        <button
          type="button"
          onClick={() => void marcar("entrada")}
          className="rounded bg-[var(--accent-2)] px-3 py-2 text-sm"
        >
          Entrada
        </button>
        <button
          type="button"
          onClick={() => void marcar("salida")}
          className="rounded bg-[var(--accent)] px-3 py-2 text-sm"
        >
          Salida
        </button>
      </form>
      {msg ? <p className="text-sm text-emerald-300">{msg}</p> : null}

      <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-[#1F6AA5] text-white">
            <tr>
              <th className="px-3 py-2">Empleado</th>
              <th className="px-3 py-2">Fecha</th>
              <th className="px-3 py-2">Entrada</th>
              <th className="px-3 py-2">Salida</th>
              <th className="px-3 py-2">Estado</th>
            </tr>
          </thead>
          <tbody>
            {marcajes.map((m) => (
              <tr key={m.id} className="border-t border-[var(--border)]">
                <td className="px-3 py-2">
                  {m.emp_codigo} — {m.emp_nombre}
                </td>
                <td className="px-3 py-2">{String(m.fecha_jornada).slice(0, 10)}</td>
                <td className="px-3 py-2">{m.entrada_at ?? "—"}</td>
                <td className="px-3 py-2">{m.salida_at ?? "—"}</td>
                <td className="px-3 py-2">{m.estado ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
