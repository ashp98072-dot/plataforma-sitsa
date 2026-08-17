"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

type Subordinado = {
  id: number;
  codigo: string;
  nombre: string;
  sueldoBase: number;
};

export default function RegistrarHorasExtraForm({
  subordinados,
}: {
  subordinados: Subordinado[];
}) {
  const router = useRouter();
  const [empleadoId, setEmpleadoId] = useState(
    subordinados[0] ? String(subordinados[0].id) : "",
  );
  const [fecha, setFecha] = useState("");
  const [horas, setHoras] = useState("");
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setMensaje("");
    setLoading(true);
    try {
      const res = await fetch("/api/portal/horas-extra", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          empleadoId: Number(empleadoId),
          fecha,
          horas: Number(horas),
          motivo,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al registrar.");
      setMensaje(data.mensaje ?? "Horas extra registradas.");
      setFecha("");
      setHoras("");
      setMotivo("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al registrar.");
    } finally {
      setLoading(false);
    }
  }

  if (subordinados.length === 0) {
    return (
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
          Registrar horas extra
        </h2>
        <p className="mt-2 text-sm text-[var(--muted)]">
          No tienes colaboradores a tu cargo registrados en el sistema.
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6"
    >
      <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
        Registrar horas extra
      </h2>
      <p className="mt-1 text-xs text-[var(--muted)]">
        El monto se calcula automáticamente (1.5x la tarifa ordinaria) y se
        suma a la siguiente boleta de pago del colaborador.
      </p>

      <label className="mt-4 block text-sm text-[var(--muted)]">
        Colaborador
        <select
          className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2"
          value={empleadoId}
          onChange={(e) => setEmpleadoId(e.target.value)}
          required
        >
          {subordinados.map((s) => (
            <option key={s.id} value={s.id}>
              {s.codigo} · {s.nombre}
            </option>
          ))}
        </select>
      </label>

      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <label className="block text-sm text-[var(--muted)]">
          Fecha trabajada
          <input
            type="date"
            className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
            required
          />
        </label>
        <label className="block text-sm text-[var(--muted)]">
          Horas
          <input
            type="number"
            step="0.5"
            min="0.5"
            max="12"
            className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2"
            value={horas}
            onChange={(e) => setHoras(e.target.value)}
            required
          />
        </label>
      </div>

      <label className="mt-3 block text-sm text-[var(--muted)]">
        Motivo (opcional)
        <textarea
          className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2"
          rows={2}
          maxLength={500}
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
        />
      </label>

      {error ? (
        <p className="mt-3 text-sm text-red-300" role="alert">
          {error}
        </p>
      ) : null}
      {mensaje ? (
        <p className="mt-3 text-sm text-[#8fd4a0]" role="status">
          {mensaje}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={loading}
        className="mt-5 w-full rounded-lg bg-[var(--accent)] px-4 py-2.5 font-medium text-white hover:brightness-110 disabled:opacity-50 sm:w-auto"
      >
        {loading ? "Registrando…" : "Registrar"}
      </button>
    </form>
  );
}
