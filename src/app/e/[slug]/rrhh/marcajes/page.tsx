"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

type Emp = { id: number; codigo: string; nombre: string; tipoHorario: string };
type Marcaje = {
  id: number;
  nombre: string;
  codigo: string;
  entrada: string;
  salida: string;
  incidencia: string;
  estado: string;
  viajeLargo: boolean;
};

export default function MarcajesPage() {
  const slug = String(useParams().slug);
  const [empleados, setEmpleados] = useState<Emp[]>([]);
  const [marcajes, setMarcajes] = useState<Marcaje[]>([]);
  const [codigo, setCodigo] = useState("");
  const [viajeLargo, setViajeLargo] = useState(false);
  const [empleadoId, setEmpleadoId] = useState(0);
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10));
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

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

  async function kiosko(ev: FormEvent) {
    ev.preventDefault();
    setError("");
    setMsg("");
    const res = await fetch(`/api/empresas/${slug}/rrhh/marcajes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ modo: "kiosko", codigo, viajeLargo }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Error");
      return;
    }
    setMsg(data.mensaje);
    setCodigo("");
    await cargar();
  }

  async function manual(tipo: "entrada" | "salida") {
    setError("");
    setMsg("");
    const res = await fetch(`/api/empresas/${slug}/rrhh/marcajes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ empleadoId, fechaJornada: fecha, tipo }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Error");
      return;
    }
    setMsg(data.mensaje);
    await cargar();
  }

  const input =
    "rounded border border-[var(--border)] bg-[#0b1217] px-2 py-1 text-sm";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Marcajes / Asistencias</h1>
        <p className="text-sm text-[var(--muted)]">
          Kiosko por código (entrada/salida automática) y marcaje manual RRHH.{" "}
          <Link
            href={`/e/${slug}/dashboard-rrhh`}
            className="text-[var(--accent)] underline"
          >
            Dashboard
          </Link>
        </p>
      </div>

      <form
        onSubmit={kiosko}
        className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 space-y-3"
      >
        <h2 className="font-medium">Kiosko</h2>
        <div className="flex flex-wrap gap-2 items-center">
          <input
            className={`${input} min-w-[12rem]`}
            placeholder="Código empleado"
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
            autoFocus
          />
          <label className="flex items-center gap-2 text-sm text-[var(--muted)]">
            <input
              type="checkbox"
              checked={viajeLargo}
              onChange={(e) => setViajeLargo(e.target.checked)}
            />
            Viaje largo (horario Variable)
          </label>
          <button className="rounded bg-[var(--accent)] px-4 py-2 text-sm text-white">
            Marcar
          </button>
        </div>
      </form>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 space-y-3">
        <h2 className="font-medium">Manual RRHH</h2>
        <div className="flex flex-wrap gap-2">
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
          <input
            type="date"
            className={input}
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
          />
          <button
            type="button"
            className="rounded bg-[#0d9488] px-3 py-1 text-sm text-white"
            onClick={() => void manual("entrada")}
          >
            Entrada
          </button>
          <button
            type="button"
            className="rounded bg-[#334155] px-3 py-1 text-sm"
            onClick={() => void manual("salida")}
          >
            Salida
          </button>
        </div>
      </div>

      {error ? <p className="text-sm text-red-300">{error}</p> : null}
      {msg ? <p className="text-sm text-emerald-300">{msg}</p> : null}

      <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
        <table className="w-full text-left text-sm">
          <thead className="bg-[#0d1522] text-[var(--muted)]">
            <tr>
              <th className="px-3 py-2">Código</th>
              <th className="px-3 py-2">Nombre</th>
              <th className="px-3 py-2">Entrada</th>
              <th className="px-3 py-2">Salida</th>
              <th className="px-3 py-2">Estado</th>
              <th className="px-3 py-2">Puntualidad</th>
            </tr>
          </thead>
          <tbody>
            {marcajes.map((m) => (
              <tr key={m.id} className="border-t border-[var(--border)]">
                <td className="px-3 py-2">{m.codigo}</td>
                <td className="px-3 py-2">{m.nombre}</td>
                <td className="px-3 py-2">{m.entrada}</td>
                <td className="px-3 py-2">{m.salida}</td>
                <td className="px-3 py-2">
                  {m.estado}
                  {m.viajeLargo ? " · viaje" : ""}
                </td>
                <td className="px-3 py-2">{m.incidencia}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
