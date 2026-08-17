"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export default function SolicitarVacacionesForm({
  saldoDisponible,
}: {
  saldoDisponible: number;
}) {
  const router = useRouter();
  const [fechaInicio, setFechaInicio] = useState("");
  const [fechaFin, setFechaFin] = useState("");
  const [tipo, setTipo] = useState<"Vacaciones" | "A cuenta de Vacaciones">(
    "Vacaciones",
  );
  const [comentario, setComentario] = useState("");
  const [error, setError] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setMensaje("");
    setLoading(true);
    try {
      const res = await fetch("/api/portal/vacaciones", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fechaInicio, fechaFin, tipo, comentario }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al enviar la solicitud.");
      setMensaje(data.mensaje ?? "Solicitud enviada.");
      setFechaInicio("");
      setFechaFin("");
      setComentario("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al enviar la solicitud.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6"
    >
      <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
        Solicitar vacaciones
      </h2>
      <p className="mt-1 text-xs text-[var(--muted)]">
        Saldo disponible: {saldoDisponible.toFixed(2)} día(s). La solicitud
        queda pendiente hasta que Recursos Humanos la apruebe.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="block text-sm text-[var(--muted)]">
          Fecha de inicio
          <input
            type="date"
            className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2"
            value={fechaInicio}
            onChange={(e) => setFechaInicio(e.target.value)}
            required
          />
        </label>
        <label className="block text-sm text-[var(--muted)]">
          Fecha fin
          <input
            type="date"
            className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2"
            value={fechaFin}
            onChange={(e) => setFechaFin(e.target.value)}
            required
          />
        </label>
      </div>

      <label className="mt-3 block text-sm text-[var(--muted)]">
        Tipo
        <select
          className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2"
          value={tipo}
          onChange={(e) =>
            setTipo(e.target.value as "Vacaciones" | "A cuenta de Vacaciones")
          }
        >
          <option value="Vacaciones">Vacaciones</option>
          <option value="A cuenta de Vacaciones">A cuenta de vacaciones</option>
        </select>
      </label>

      <label className="mt-3 block text-sm text-[var(--muted)]">
        Comentario (opcional)
        <textarea
          className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2"
          rows={2}
          maxLength={500}
          value={comentario}
          onChange={(e) => setComentario(e.target.value)}
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
        {loading ? "Enviando…" : "Enviar solicitud"}
      </button>
    </form>
  );
}
