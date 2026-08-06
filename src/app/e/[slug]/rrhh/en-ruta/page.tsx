"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

type Emp = { id: number; codigo: string; nombre: string };
type Reg = {
  id: number;
  codigo: string;
  nombre: string;
  fechaInicio: string;
  fechaFin: string;
  comentario: string;
};

export default function EnRutaPage() {
  const slug = String(useParams().slug);
  const [variables, setVariables] = useState<Emp[]>([]);
  const [registros, setRegistros] = useState<Reg[]>([]);
  const [empleadoId, setEmpleadoId] = useState(0);
  const [fechaInicio, setFechaInicio] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [fechaFin, setFechaFin] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [comentario, setComentario] = useState("");
  const [msg, setMsg] = useState("");

  const cargar = useCallback(async () => {
    const res = await fetch(
      `/api/empresas/${slug}/rrhh/en-ruta?desde=${fechaInicio}&hasta=${fechaFin}`,
    );
    const data = await res.json();
    setVariables(data.variables ?? []);
    setRegistros(data.registros ?? []);
    if (!empleadoId && data.variables?.[0]) {
      setEmpleadoId(data.variables[0].id);
    }
  }, [slug, fechaInicio, fechaFin, empleadoId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const res = await fetch(`/api/empresas/${slug}/rrhh/en-ruta`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        empleadoId,
        fechaInicio,
        fechaFin,
        comentario,
      }),
    });
    const data = await res.json();
    setMsg(data.mensaje || data.error);
    if (res.ok) {
      setComentario("");
      await cargar();
    }
  }

  const input =
    "rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1 text-sm";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">En Ruta</h1>
        <p className="text-sm text-[var(--muted)]">
          Personal con horario Variable en viaje/ruta (no marca falta en
          reportes).{" "}
          <Link
            href={`/e/${slug}/rrhh/vacaciones`}
            className="text-[var(--accent)] underline"
          >
            Vacaciones
          </Link>
        </p>
      </div>

      <form
        onSubmit={onSubmit}
        className="flex flex-wrap gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4"
      >
        <select
          className={input}
          value={empleadoId}
          onChange={(e) => setEmpleadoId(Number(e.target.value))}
        >
          {variables.length === 0 ? (
            <option value={0}>Sin empleados Variable</option>
          ) : (
            variables.map((e) => (
              <option key={e.id} value={e.id}>
                {e.codigo} — {e.nombre}
              </option>
            ))
          )}
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
        <input
          className={`${input} min-w-[12rem]`}
          placeholder="Comentario"
          value={comentario}
          onChange={(e) => setComentario(e.target.value)}
        />
        <button className="rounded bg-[var(--accent)] px-3 py-1 text-sm text-white">
          Registrar
        </button>
      </form>

      {msg ? <p className="text-sm text-emerald-300">{msg}</p> : null}

      <ul className="space-y-1 text-sm">
        {registros.map((r) => (
          <li
            key={r.id}
            className="flex items-center justify-between rounded border border-[var(--border)] px-3 py-2"
          >
            <span>
              {r.codigo} — {r.nombre} · {r.fechaInicio} → {r.fechaFin}
              {r.comentario ? ` · ${r.comentario}` : ""}
            </span>
            <button
              type="button"
              className="text-xs text-red-300 underline"
              onClick={async () => {
                await fetch(`/api/empresas/${slug}/rrhh/en-ruta?id=${r.id}`, {
                  method: "DELETE",
                });
                await cargar();
              }}
            >
              Eliminar
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
